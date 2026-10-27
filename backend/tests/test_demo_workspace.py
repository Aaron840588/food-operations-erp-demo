import asyncio
import base64
import json
import unittest
from datetime import date
import zlib
import httpx2 as httpx
from app.main import app
from app import auth
from app.database import get_db


class DemoWorkspaceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test')
        self.state = None

    async def asyncTearDown(self):
        await self.client.aclose()

    async def call(self, path, method='GET', payload=None, role='owner'):
        response = await self.client.post('/demo-workspace', json={'path': path, 'method': method, 'payload': payload, 'state': self.state, 'role': role})
        self.assertEqual(response.status_code, 200, response.text[:200])
        data = response.json()
        self.state = data['state']
        return data

    async def test_original_read_screens_are_backed_by_isolated_sample_database(self):
        for path in ['/products', '/raw-ingredients', '/warehouses', '/warehouses/stocks', '/costing/analysis', '/costing/recipes', '/production/catalog', '/production/plans', '/dashboard/summary', '/consignment/partners', '/resellers/orders', '/tasks/cleaning', '/tasks/maintenance', '/timesheets', '/timesheets/calculator', '/gift-sets', '/gift-sets/overhead-rates', '/users', '/market-events', '/preorders', '/preorders/forms']:
            with self.subTest(path=path):
                self.assertEqual((await self.call(path))['status'], 200)
        self.assertNotIn(get_db, app.dependency_overrides)
        self.assertNotIn(auth.get_current_user, app.dependency_overrides)

    async def test_mutations_persist_only_in_supplied_workspace_and_staff_permissions_hold(self):
        created = await self.call('/tasks/cleaning', 'POST', {'task_name': 'Fictional regression task', 'frequency': 'Daily'})
        self.assertEqual(created['status'], 200)
        self.assertIn('Fictional regression task', str((await self.call('/tasks/cleaning'))['data']))
        isolated = await self.client.post('/demo-workspace', json={'path': '/tasks/cleaning'})
        self.assertNotIn('Fictional regression task', str(isolated.json()['data']))
        denied = await self.call('/users', role='staff')
        self.assertEqual(denied['status'], 403)
        self.assertNotIn('hashed_password', str(denied['data']))

    async def test_parallel_visitors_cannot_share_records(self):
        async def visitor(name):
            r = await self.client.post('/demo-workspace', json={'path': '/tasks/cleaning', 'method': 'POST', 'payload': {'task_name': name, 'frequency': 'Daily'}})
            return r.json()
        a, b = await asyncio.gather(visitor('Visitor A sample'), visitor('Visitor B sample'))
        for state, own, other in [(a['state'], 'Visitor A sample', 'Visitor B sample'), (b['state'], 'Visitor B sample', 'Visitor A sample')]:
            r = await self.client.post('/demo-workspace', json={'path': '/tasks/cleaning', 'state': state})
            self.assertIn(own, str(r.json()['data']))
            self.assertNotIn(other, str(r.json()['data']))

    async def test_stock_sale_consignment_and_production_use_original_business_rules(self):
        today = date.today().isoformat()
        async def stock():
            rows = (await self.call('/products'))['data']
            return next(row['warehouse_stock'] for row in rows if row['sku'] == 'PESTO-180')
        self.assertEqual(await stock(), 60)
        invoice = await self.call('/resellers/orders', 'POST', {'reseller_name': 'Sample integration buyer', 'order_date': today, 'tax_rate': 0, 'items': [{'sku': 'PESTO-180', 'quantity': 3}]})
        self.assertEqual(invoice['status'], 200, invoice['data'])
        self.assertEqual(await stock(), 57)
        delivery = await self.call('/consignment/deliveries', 'POST', {'partner_id': 1, 'delivery_date': today, 'items': [{'sku': 'PESTO-180', 'target_qty': 2, 'outlet': 'Sample café'}]})
        self.assertEqual(delivery['status'], 200, delivery['data'])
        self.assertEqual(await stock(), 55)
        produced = await self.call('/production/plans/complete', 'POST', {'plan_date': today, 'targets': [{'sku': 'PESTO-180', 'outlet': 'General', 'target_qty': 4}]})
        self.assertEqual(produced['status'], 200, produced['data'])
        self.assertEqual(await stock(), 59)
        again = await self.call('/production/plans/complete', 'POST', {'plan_date': today, 'targets': [{'sku': 'PESTO-180', 'outlet': 'General', 'target_qty': 4}]})
        self.assertEqual(again['status'], 200)
        self.assertEqual(await stock(), 59)

    async def test_outside_connections_and_untrusted_state_are_rejected(self):
        for path in ['https://example.invalid', '/auth/refresh', '/backup', '/sheet-sync/check', '/push/test', '/demo-workspace', '//example.invalid/products']:
            response = await self.client.post('/demo-workspace', json={'path': path})
            self.assertEqual(response.status_code, 400)
        bad = base64.b64encode(zlib.compress(json.dumps({'raw_ingredients; DROP TABLE users': []}).encode())).decode()
        response = await self.client.post('/demo-workspace', json={'path': '/products', 'state': bad})
        self.assertEqual(response.status_code, 400)
        bomb = base64.b64encode(zlib.compress(b'a' * 2_000_001)).decode()
        response = await self.client.post('/demo-workspace', json={'path': '/products', 'state': bomb})
        self.assertEqual(response.status_code, 400)
        self.assertEqual((await self.call('/products'))['status'], 200)
