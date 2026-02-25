from setuptools import setup, find_packages

with open("requirements.txt") as f:
    install_requires = f.read().strip().split("\n")

from kaitet_taskwork import __version__ as version

setup(
    name="kaitet_taskwork",
    version=version,
    description="Kaitet Task Work Management System",
    author="Upande",
    author_email="dev@upande.com",
    packages=find_packages(),
    zip_safe=False,
    include_package_data=True,
    install_requires=install_requires,
)
