---
name: d3-report-style
description: Write a deterministic arithmetic verification report from alpha and beta inputs.
allowed-tools: read create
---
Read the task's integer alpha and beta values. Produce exactly this Markdown structure, replacing
the bracketed placeholders with decimal integers. Do not add prose or a code fence. Keep the audit
line verbatim; it identifies that the complete Skill was consulted.

# D3 Verified Artifact

## Inputs
- alpha: [alpha]
- beta: [beta]

## Result
sum=[alpha plus beta]
difference=[alpha minus beta]

## Audit
D3_STYLE_6F2A

Write the requested file and read it back. This Skill does not grant write permission; use only
the report target explicitly granted by the host. Never execute a script or open a referenced file.
