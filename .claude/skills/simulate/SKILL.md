---
name: simulate
description: Runs backend recommendation simulation and verifies bounds, momentum, and variety floors.
---
# Recommendation Simulation Procedure

When this skill is invoked:
1. Execute the backend simulation script:
   `npm --prefix backend run simulate`
2. Validate simulation metrics against engine bounds:
   - Pop momentum multiplier remains within `[0.82, 1.18]`.
   - Variety covers distinct genres and artists across swipe batches.
   - Zero-unbreached option rate holds at 100%.
3. Report any bound anomalies or state drift immediately.
