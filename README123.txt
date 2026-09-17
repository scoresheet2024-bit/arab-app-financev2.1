ARAB REPORTING SYSTEM — INDIVIDUAL PAGE ACCESS

This package adds per-user access control for:
  1. Games
  2. Assigned Games
  3. Official Activity
  4. Game Reports

ADMIN SETUP
1. Back up your current project.
2. Copy sql_user_page_permissions.sql to your project and run it in the ARAB PostgreSQL database.
3. Replace the included files using the same folders:
   - app.js
   - middleware/auth.js
   - middleware/permissions.js
   - routes/users.js
   - routes/assignedGames.js
   - routes/gameReports.js
   - routes/officialActivity.js
   - routes/games.js
   - navigation/menu.js
   - views/partials/navigation.ejs
   - views/users/edit.ejs
   - views/users/index.ejs
4. Restart the Node application.
5. Open User Management -> Edit for a user.
6. Under Page Access Permissions, select the pages that user may access.
7. Save Changes.

IMPORTANT
- Administrators automatically have access to all four pages.
- Non-admin users receive only the page permissions stored in public.user_permissions.
- Page permissions are independent of role.
- Existing Admin-only game creation/assignment protections remain in place.
- Existing assigned-game protection for official/TO game documents and reports remains in place where those routes require it.
- Users created after this change start with no optional page permissions. Admin can grant them from Edit User.

Permission codes:
  games_view
  assigned_games_view
  official_activity_view
  game_reports_view
