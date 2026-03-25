"""Test the Python SDK against the running server on port 3333."""
import sys
sys.path.insert(0, 'sdk/python')

from agent_marketplace import Marketplace, ContentRecord, ArtifactRecord

passed = 0
failed = 0

def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"PASS: {name}")
    else:
        failed += 1
        print(f"FAIL: {name} -- {detail}")

m = Marketplace("http://127.0.0.1:3333")

# 1. Check for non-existent content
try:
    result = m.check("https://sdk-test.example.com/nonexistent")
    check("check non-existent", result.get("available") == False, str(result))
except Exception as e:
    check("check non-existent", False, str(e))

# 2. Publish content
try:
    result = m.publish_content(
        url="https://sdk-test.example.com/page1",
        content={"text": "SDK test content", "structured": {"headings": [{"level": 1, "text": "Title"}]}, "source_hash": "sdkhash123"},
        price=0.02,
        token_cost_saved=0.10,
    )
    check("publish_content", result.get("url") == "https://sdk-test.example.com/page1", str(result))
except Exception as e:
    check("publish_content", False, str(e))

# 3. Check the published content
try:
    result = m.check("https://sdk-test.example.com/page1")
    check("check published", result.get("available") == True, str(result))
except Exception as e:
    check("check published", False, str(e))

# 4. Fetch the published content
try:
    record = m.fetch("https://sdk-test.example.com/page1")
    check("fetch published", isinstance(record, ContentRecord) and record.text == "SDK test content", str(record))
except Exception as e:
    check("fetch published", False, str(e))

# 5. Search
try:
    results = m.search("SDK test")
    check("search", len(results) > 0, str(results))
except Exception as e:
    check("search", False, str(e))

# 6. Publish artifact
try:
    result = m.publish_artifact(
        name="SDK Test Tool",
        description="A test artifact from the SDK",
        category="tool",
        files=["tool.py"],
        price=1.0,
        slug="sdk-test-tool",
        tags=["test", "sdk"],
    )
    check("publish_artifact", result.get("slug") == "sdk-test-tool", str(result))
except Exception as e:
    check("publish_artifact", False, str(e))

# 7. Get artifact
try:
    artifact = m.get_artifact("sdk-test-tool")
    check("get_artifact", isinstance(artifact, ArtifactRecord) and artifact.name == "SDK Test Tool", str(artifact))
except Exception as e:
    check("get_artifact", False, str(e))

# 8. Download artifact
try:
    result = m.download_artifact("sdk-test-tool")
    check("download_artifact", result.get("slug") == "sdk-test-tool", str(result))
except Exception as e:
    check("download_artifact", False, str(e))

# 9. Trending
try:
    result = m.trending("7d")
    check("trending", isinstance(result, dict), str(result))
except Exception as e:
    check("trending", False, str(e))

# 10. Gaps
try:
    result = m.gaps()
    check("gaps", isinstance(result, list), str(result))
except Exception as e:
    check("gaps", False, str(e))

# 11. Smart fetch (cache hit from prior fetch)
try:
    result = m.smart_fetch("https://sdk-test.example.com/page1")
    check("smart_fetch cache hit", result is not None and result.text == "SDK test content", str(result))
except Exception as e:
    check("smart_fetch cache hit", False, str(e))

# 12. Smart fetch non-existent
try:
    result = m.smart_fetch("https://sdk-test.example.com/does-not-exist")
    check("smart_fetch non-existent", result is None, str(result))
except Exception as e:
    check("smart_fetch non-existent", False, str(e))

print(f"\n=== SDK LIVE TEST RESULTS ===")
print(f"Total: {passed} passed, {failed} failed out of {passed + failed}")
sys.exit(1 if failed > 0 else 0)
