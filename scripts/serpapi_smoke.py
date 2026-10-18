"""SerpAPI Google Shopping smoke test.

Usage: SERPAPI_KEY=... python3 serpapi_smoke.py "breville bambino espresso machine"
Checks: auth works, latency, result count, and that fields we need are present.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

NEEDED = ["title", "extracted_price", "source", "product_link", "thumbnail"]


def search(q, key):
    params = {"engine": "google_shopping", "q": q, "gl": "us", "hl": "en", "api_key": key}
    url = "https://serpapi.com/search.json?" + urllib.parse.urlencode(params)
    t0 = time.time()
    with urllib.request.urlopen(url, timeout=30) as r:
        data = json.load(r)
    return data, time.time() - t0


def main():
    key = os.environ.get("SERPAPI_KEY")
    if not key:
        sys.exit("Set SERPAPI_KEY")
    q = sys.argv[1] if len(sys.argv) > 1 else "breville bambino espresso machine"
    data, secs = search(q, key)
    if "error" in data:
        sys.exit(f"API error: {data['error']}")
    results = data.get("shopping_results", [])
    print(f"query={q!r} latency={secs:.2f}s results={len(results)} "
          f"cached={data.get('search_metadata', {}).get('status')}")
    missing = {f for r in results[:10] for f in NEEDED if f not in r}
    print("missing fields in top 10:", missing or "none")
    for r in sorted(results[:10], key=lambda r: r.get("extracted_price") or 1e9):
        print(f"  ${r.get('extracted_price')!s:>8}  {r.get('source', '?')[:20]:20}  {r.get('title', '')[:60]}")


if __name__ == "__main__":
    main()
