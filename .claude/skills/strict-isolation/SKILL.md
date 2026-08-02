---
name: strict-isolation
description: Use whenever generating, modifying, or reviewing the recommendation engine, database queries, or user-matching logic.
---
# Recommendation Engine Constraints
- **Database:** Queries run against SQLite via node:sqlite (`DatabaseSync`), not better-sqlite3.
- **Absolute Data Isolation:** The recommendation algorithm must ONLY be impacted by the user's direct inputs. 
- **NO Collaborative Filtering:** Completely exclude any collaborative filtering layers.
- **NO Friend Graphs:** Do not implement or suggest friend graph tracking or cross-user data pollination.
- **Session Mechanics:** Ensure custom session-purging mechanics are maintained for isolated taste-exploration workflows.
