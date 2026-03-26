from setuptools import setup, find_packages

setup(
    name="agent-marketplace",
    version="1.0.0",
    packages=find_packages(),
    install_requires=["requests>=2.28.0", "httpx>=0.24.0"],
    python_requires=">=3.8",
    description="SDK for the Agent Marketplace — find code, content, and artifacts for AI agents",
    author="SCJedi",
    license="MIT",
)
