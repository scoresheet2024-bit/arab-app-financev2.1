ARAB CLEAN PERMISSIONS - FIXED

Admin
- Full access to Dashboard, Competitions, Games, Game Assignment, Officials, Statistics, Official Activity, Game Reports, Finance and User Management.
- Admin is never converted into another role.

Normal users
- Officials: view only
- Games: view only
- Create Game: blocked
- Assign/Reassign Officials: blocked
- Assigned Games: view only
- Game Reports: access according to the report workflow
- Finance: view only
- Dashboard, Competitions, Statistics, Official Activity and User Management: blocked

Important
- The server checks the real req.user.role from the database.
- Direct URLs such as /games/new and /games/assign/:id are protected.
- Normal users are not given admin privileges.

Replace these files in your project:
app.js
middleware/permissions.js
routes/games.js
navigation/menu.js

Then restart:
node app.js
