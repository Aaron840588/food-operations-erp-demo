"""Verify deployed HTML AND every referenced JS/CSS asset, not HTML alone.

Usage: python scripts/check_deployment.py https://your-deployment.example
Uses public HTTP only. Protected previews must be reviewed in an authenticated browser.
"""
import sys
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = set()

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "script" and values.get("src"):
            self.urls.add(values["src"])
        if tag == "link" and values.get("rel") == "stylesheet":
            self.urls.add(values["href"])


def check(base):
    origin = urlsplit(base).netloc
    def fetch(url):
        if urlsplit(url).netloc != origin:
            raise AssertionError("Unexpected external asset origin")
        with urlopen(Request(url, headers={"User-Agent": "H-H-release-check"}), timeout=30) as response:
            return response.headers.get_content_type(), response.read()

    content_type, html = fetch(urljoin(base, "/"))
    assert content_type == "text/html"
    assert b"Opening sample workspace" in html, "Demo entry is missing"
    parser = Assets()
    parser.feed(html.decode())
    assert any(".css" in path for path in parser.urls), "No stylesheet references"
    assert any(".js" in path for path in parser.urls), "No JavaScript references"
    for path in sorted(parser.urls):
        kind, body = fetch(urljoin(base, path))
        expected = "text/css" if urlsplit(path).path.endswith(".css") else "javascript"
        assert expected in kind, f"Wrong asset content type: {path} ({kind})"
        assert body, f"Empty asset: {path}"
        print(f"OK {path} ({len(body)} bytes)")
    print(f"PASS: demo HTML and {len(parser.urls)} referenced assets")


if __name__ == "__main__":
    check(sys.argv[1])
