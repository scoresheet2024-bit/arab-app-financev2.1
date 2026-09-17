ARAB USER RESTRICTED ACCESS
===========================

This version implements the following access level for authenticated users:

1. Officials       - View / Access only
2. Games           - View / Access only
3. Game Assignment - FULL access, including assignment, viewing report and submitting report
4. Game Reports    - View / Access and report submission
5. Finance         - View / Access only

Restricted sections:
- Dashboard
- Competitions
- Statistics
- Official Activity
- User Management

Important:
- The database user roles are NOT changed.
- Authentication remains active.
- For legacy route compatibility, the app temporarily exposes req.user.role as
  'admin' only while processing permitted Game Assignment / Game Report routes.
- This does not update the role stored in PostgreSQL.

Files to replace:
- app.js
- middleware/permissions.js
- middleware/upload.js
- routes/games.js
- routes/assignedGames.js
- routes/gameReports.js
- navigation/menu.js

Back up the current files before replacing them.

After replacement:
1. Stop the running Node server (Ctrl+C).
2. Run: node app.js
3. Log in with a normal user account.
4. Test only the five permitted sections.
