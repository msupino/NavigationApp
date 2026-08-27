# FE grounding — iOS foreground location permission declaration

## What this change touches

The change is confined to native permission metadata, native wrapper validation, contract coverage, and documentation. It does not alter an application-rendered component or layout.

## What the app already ships

The existing **Show location** action and GPS rendering path remain unchanged.

## What binds

No design-system obligation applies because the fix adds no application UI.

## Unclear

NavAid is not registered in the design-intelligence product resolver, which only identifies DAP and Cyber products. This does not change the code-walk result because the fix adds no application UI.

**Grounded by**: code walk (native plist and validation to the existing GPS action) · KB (unavailable — no NavAid product profile) · DS MCP (unavailable — no NavAid product profile)
