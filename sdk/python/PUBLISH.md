# Publishing to PyPI

## First time setup
```bash
pip install build twine
```

## Build
```bash
cd sdk/python
python -m build
```

This creates `dist/agent-marketplace-1.0.0.tar.gz` and `dist/agent_marketplace-1.0.0-py3-none-any.whl`.

## Upload to TestPyPI first (recommended)
```bash
twine upload --repository testpypi dist/*
```

Test the install:
```bash
pip install --index-url https://test.pypi.org/simple/ agent-marketplace
```

## Upload to PyPI (requires PyPI account)
```bash
twine upload dist/*
```

You'll be prompted for your PyPI username and password (or API token).

## Using an API token (recommended)
1. Create a token at https://pypi.org/manage/account/token/
2. Use `__token__` as the username and the token as the password
3. Or create a `~/.pypirc` file:
```ini
[pypi]
username = __token__
password = pypi-YOUR-TOKEN-HERE
```

## Verify
```bash
pip install agent-marketplace
python -c "from agent_marketplace import Marketplace; print('OK')"
```
