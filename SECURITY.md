# Security Policy

## Scope

This server runs locally over stdio, makes read-only GET requests to official
French open-data endpoints, requires no credentials and stores nothing on
disk. The main risks to users are therefore:

- responses crafted by a compromised upstream dataset being relayed to an LLM;
- dependency-chain issues.

## Reporting a vulnerability

Please email **omar.benpro@gmail.com** with a description and reproduction
steps. You should receive a reply within 72 hours. Please do not open a public
issue for an unpatched vulnerability.

## Supported versions

Only the latest published minor version receives fixes.
