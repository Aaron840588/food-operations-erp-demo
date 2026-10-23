"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  Package,
  ClipboardList,
  Calculator,
  LayoutDashboard,
  RotateCcw,
  ArrowRight,
} from "lucide-react";
import {
  initialDemo,
  transition,
  products,
  estimateCost,
  type DemoAction,
  type ProductId,
} from "@/lib/fictionalDemo";

const money = (n: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(n);
const sections = ["Overview", "Inventory", "Orders", "Costing"] as const;
const icons = [LayoutDashboard, Package, ClipboardList, Calculator];

export default function FictionalDemo() {
  const [state, setState] = useState(initialDemo);
  const [section, setSection] = useState<(typeof sections)[number]>("Overview");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [product, setProduct] = useState<ProductId>("pesto");
  const [quantity, setQuantity] = useState("4");
  const [customer, setCustomer] = useState("Sample café A");
  const [receive, setReceive] = useState("10");
  const [costProduct, setCostProduct] = useState<ProductId>("pesto");
  const [batch, setBatch] = useState("12");
  const [price, setPrice] = useState("240");
  const recipe = products.find((p) => p.id === costProduct)!;
  const estimate = estimateCost(recipe.cost, Number(price), Number(batch));
  const fulfilled = state.orders.filter((o) => o.status === "Fulfilled");
  const revenue = fulfilled.reduce((sum, o) => sum + o.price * o.quantity, 0);
  const profit = fulfilled.reduce(
    (sum, o) => sum + (o.price - o.cost) * o.quantity,
    0,
  );
  const queued = state.orders.filter((o) => o.status === "Queued");
  const change = (action: DemoAction) => {
    try {
      const next = transition(state, action);
      setState(next);
      setError("");
      setNotice(next.activity[0]);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to update sample data.",
      );
      setNotice("");
    }
  };
  const navigate = (next: typeof section) => {
    setSection(next);
    setError("");
    setNotice("");
  };
  return (
    <div className="fictional-demo">
      <a className="demo-skip" href="#demo-main">
        Skip to workspace
      </a>
      <div className="demo-disclosure">
        <span>
          <strong>Interactive sample</strong> · Fictional data. Changes stay in
          this tab and reset on refresh.
        </span>
        <button onClick={() => setConfirmReset(true)}>
          <RotateCcw size={14} aria-hidden="true" /> Reset demo
        </button>
      </div>
      {confirmReset && (
        <div className="demo-reset">
          <span>Restore the original sample records?</span>
          <button
            onClick={() => {
              change({ type: "reset" });
              setConfirmReset(false);
              setSearch("");
              setFilter("All");
            }}
          >
            Restore sample data
          </button>
          <button onClick={() => setConfirmReset(false)}>Keep exploring</button>
        </div>
      )}
      <div className="demo-shell">
        <aside className="demo-sidebar">
          <a className="demo-brand" href="/demo">
            <strong>
              H+H<span> / </span>
            </strong>
            <span>
              Food operations
              <br />
              Sample workspace
            </span>
          </a>
          <p className="demo-eyebrow">WORKSPACE</p>
          <nav aria-label="Demo sections">
            {sections.map((item, i) => {
              const Icon = icons[i];
              return (
                <button
                  key={item}
                  aria-current={section === item ? "page" : undefined}
                  onClick={() => navigate(item)}
                >
                  <Icon size={18} aria-hidden="true" />
                  {item}
                </button>
              );
            })}
          </nav>
          <div className="demo-sidebar-foot">
            <p>
              From the kitchen
              <br />
              to the customer.
            </p>
            <a href="https://aarontagapan.vercel.app/work/hh-hub">
              Read the case study <ArrowUpRight size={15} aria-hidden="true" />
            </a>
            <a href="https://github.com/Aaron840588/food-operations-erp-demo">
              View source <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </div>
        </aside>
        <main id="demo-main" tabIndex={-1} className="demo-main">
          <header className="demo-header">
            <div>
              <p className="demo-eyebrow">H+H HUB / {section.toUpperCase()}</p>
              <h1>
                {section === "Overview"
                  ? "A clear view of the kitchen."
                  : section === "Inventory"
                    ? "Know what’s on the shelf."
                    : section === "Orders"
                      ? "Keep orders moving."
                      : "Know your margins."}
              </h1>
              <p>
                {section === "Overview"
                  ? "Follow a small food business from stock intake to fulfilled orders."
                  : section === "Inventory"
                    ? "Receive sample finished goods before fulfilling an order."
                    : section === "Orders"
                      ? "Queue, fulfil or cancel fictional orders. No payments are collected."
                      : "Explore batch economics using illustrative costs and prices."}
              </p>
            </div>
            <span className="demo-chip">Browser-only demo</span>
          </header>
          <p className="demo-feedback" role="status">
            {notice}
          </p>
          {error && (
            <p className="demo-error" role="alert">
              {error}
            </p>
          )}
          {section === "Overview" && (
            <>
              <section className="demo-metrics" aria-label="Workspace totals">
                {[
                  ["Fulfilled sales", money(revenue)],
                  ["Gross profit", money(profit)],
                  ["Queued orders", String(queued.length)],
                  [
                    "Units on hand",
                    String(
                      Object.values(state.stock).reduce((a, b) => a + b, 0),
                    ),
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </section>
              <div className="demo-grid">
                <section className="demo-panel demo-guide">
                  <p className="demo-eyebrow">TRY THE WORKFLOW</p>
                  <h2>One order. Every step connected.</h2>
                  <p>
                    Order #1002 needs 10 jars of tomato sauce. There are only 8
                    on hand. Receive more stock, fulfil the order, then watch
                    your totals update.
                  </p>
                  <ol>
                    <li>Receive 10 jars in Inventory</li>
                    <li>Fulfil order #1002 in Orders</li>
                    <li>Review sales and gross profit here</li>
                  </ol>
                  <button
                    className="demo-primary"
                    onClick={() => navigate("Inventory")}
                  >
                    Start with inventory{" "}
                    <ArrowRight size={17} aria-hidden="true" />
                  </button>
                </section>
                <section className="demo-panel">
                  <p className="demo-eyebrow">ORDER PIPELINE</p>
                  <h2>{queued.length} awaiting fulfilment</h2>
                  {state.orders
                    .filter((o) => o.status === "Queued")
                    .map((o) => (
                      <div className="demo-pipeline" key={o.id}>
                        <div>
                          <strong>
                            #{o.id} · {o.customer}
                          </strong>
                          <p>
                            {o.quantity} ×{" "}
                            {products.find((p) => p.id === o.product)!.name}
                          </p>
                        </div>
                        <span className="demo-chip">
                          {state.stock[o.product] >= o.quantity
                            ? "Stock ready"
                            : "Needs stock"}
                        </span>
                      </div>
                    ))}
                  {!queued.length && (
                    <p>
                      All caught up. Create a sample order to keep exploring.
                    </p>
                  )}
                  <button
                    className="demo-text-button"
                    onClick={() => navigate("Orders")}
                  >
                    View orders →
                  </button>
                </section>
              </div>
              <section className="demo-panel demo-activity">
                <p className="demo-eyebrow">ACTIVITY</p>
                <h2>A record of your session</h2>
                <ol>
                  {state.activity.map((entry, i) => (
                    <li key={`${i}-${entry}`}>{entry}</li>
                  ))}
                </ol>
              </section>
            </>
          )}
          {section === "Inventory" && (
            <section className="demo-panel">
              <div className="demo-toolbar">
                <h2>Finished goods</h2>
                <label>
                  Search products
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Name or category"
                  />
                </label>
                <label>
                  Units to receive
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    step="1"
                    value={receive}
                    onChange={(e) => setReceive(e.target.value)}
                  />
                </label>
              </div>
              <div className="demo-table-wrap">
                <table>
                  <caption className="sr-only">
                    Sample inventory balances
                  </caption>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>On hand</th>
                      <th>Unit cost</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products
                      .filter((p) =>
                        `${p.name} ${p.category}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((p) => (
                        <tr key={p.id}>
                          <td>
                            <strong>{p.name}</strong>
                            <small>
                              {p.category} · {p.unit}
                            </small>
                          </td>
                          <td>{state.stock[p.id]} units</td>
                          <td>{money(p.cost)}</td>
                          <td>
                            <button
                              aria-label={`Receive ${p.name}`}
                              onClick={() =>
                                change({
                                  type: "receive",
                                  product: p.id,
                                  quantity: Number(receive),
                                })
                              }
                            >
                              Receive stock
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {!products.some((p) =>
                `${p.name} ${p.category}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              ) && (
                <p className="demo-empty">
                  No matching products. Try another search.
                </p>
              )}
              <p className="demo-note">
                Simplified finished-goods balances. This sample does not
                simulate ingredient purchasing, production batches or FIFO lots.
              </p>
            </section>
          )}
          {section === "Orders" && (
            <>
              <section className="demo-panel">
                <h2>Create a sample order</h2>
                <form
                  className="demo-order-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    change({
                      type: "order",
                      product,
                      quantity: Number(quantity),
                      customer,
                    });
                  }}
                >
                  <label>
                    Sample customer
                    <select
                      value={customer}
                      onChange={(e) => setCustomer(e.target.value)}
                    >
                      {[
                        "Sample café A",
                        "Sample market B",
                        "Sample shop C",
                      ].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Product
                    <select
                      value={product}
                      onChange={(e) => setProduct(e.target.value as ProductId)}
                    >
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Quantity
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      step="1"
                      required
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                  </label>
                  <button className="demo-primary" type="submit">
                    Queue order
                  </button>
                </form>
              </section>
              <section className="demo-panel">
                <div className="demo-toolbar">
                  <h2>Order book</h2>
                  <label>
                    Order status
                    <select
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      {["All", "Queued", "Fulfilled", "Cancelled"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="demo-table-wrap">
                  <table>
                    <caption className="sr-only">Fictional orders</caption>
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Product</th>
                        <th>Total</th>
                        <th>Status / actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.orders
                        .filter((o) => filter === "All" || o.status === filter)
                        .map((o) => (
                          <tr key={o.id}>
                            <td>
                              <strong>#{o.id}</strong>
                              <small>{o.customer}</small>
                            </td>
                            <td>
                              {products.find((p) => p.id === o.product)!.name}
                              <small>
                                {o.quantity} units × {money(o.price)}
                              </small>
                            </td>
                            <td>{money(o.quantity * o.price)}</td>
                            <td>
                              <span className="demo-chip">{o.status}</span>
                              {o.status === "Queued" && (
                                <div className="demo-row-actions">
                                  <button
                                    aria-label={`Fulfil order ${o.id}`}
                                    onClick={() =>
                                      change({ type: "fulfil", id: o.id })
                                    }
                                  >
                                    Fulfil
                                  </button>
                                  <button
                                    aria-label={`Cancel order ${o.id}`}
                                    onClick={() =>
                                      change({ type: "cancel", id: o.id })
                                    }
                                  >
                                    Cancel
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {!state.orders.some(
                  (o) => filter === "All" || o.status === filter,
                ) && (
                  <p className="demo-empty">
                    No {filter.toLowerCase()} orders yet.
                  </p>
                )}
                <p className="demo-note">
                  Fulfilment deducts stock once. Cancellation leaves stock
                  unchanged. Sales and costs use the values recorded when an
                  order was created.
                </p>
              </section>
            </>
          )}
          {section === "Costing" && (
            <div className="demo-grid">
              <section className="demo-panel">
                <p className="demo-eyebrow">BATCH ESTIMATE</p>
                <h2>Price with a little more clarity.</h2>
                <div className="demo-cost-form">
                  <label>
                    Recipe
                    <select
                      value={costProduct}
                      onChange={(e) => {
                        const p = products.find(
                          (p) => p.id === e.target.value,
                        )!;
                        setCostProduct(p.id);
                        setPrice(String(p.price));
                      }}
                    >
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Batch quantity
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      step="1"
                      value={batch}
                      onChange={(e) => setBatch(e.target.value)}
                    />
                  </label>
                  <label>
                    Selling price per unit (PHP)
                    <input
                      type="number"
                      min="1"
                      max="100000"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                    />
                  </label>
                </div>
                <p className="demo-note">
                  Illustrative unit cost: {money(recipe.cost)}. Includes assumed
                  ingredients and packaging. Excludes labour, overhead, tax and
                  delivery. This calculator does not change order prices.
                </p>
              </section>
              <section
                className="demo-panel demo-cost-result"
                aria-live="polite"
              >
                <p className="demo-eyebrow">YOUR ESTIMATE</p>
                {estimate ? (
                  <>
                    <h2>{money(estimate.profit)}</h2>
                    <p>Estimated gross profit for {batch} units</p>
                    <dl>
                      <div>
                        <dt>Batch cost</dt>
                        <dd>{money(estimate.cost)}</dd>
                      </div>
                      <div>
                        <dt>Sales value</dt>
                        <dd>{money(estimate.revenue)}</dd>
                      </div>
                      <div>
                        <dt>Gross margin</dt>
                        <dd>{estimate.margin.toFixed(1)}%</dd>
                      </div>
                    </dl>
                    {estimate.profit < 0 && (
                      <p className="demo-error">
                        Selling below the illustrative unit cost.
                      </p>
                    )}
                  </>
                ) : (
                  <p>
                    Enter a positive price and a whole batch quantity between 1
                    and 1,000.
                  </p>
                )}
              </section>
            </div>
          )}
          <footer className="demo-footer">
            A focused simulation of inventory, orders and costing. The separate
            database-backed prototype is unavailable. No real customer, employee
            or payment data is used.
          </footer>
        </main>
      </div>
    </div>
  );
}
