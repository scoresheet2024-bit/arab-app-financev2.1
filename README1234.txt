ARAB Game Report Assignment Security
====================================

Replace these files in your application:

1. app.js
2. middleware/permissions.js
3. routes/gameReports.js

Behavior implemented:
- Admin: can view and submit reports for all games.
- Referee: can view/submit reports only for games assigned to their officialid.
- Official: can view/submit reports only for games assigned to their officialid.
- TO: can view/submit reports only for games assigned to their officialid.
- Finance: cannot access Game Reports.
- /game-reports list is filtered for Referee/Official/TO to their assigned games.
- Direct URL access such as /games/report/47 is checked server-side.
- Report submission POST is checked server-side BEFORE file upload.
- Game document upload/list endpoints are also assignment-protected.
- Assigned Games remains an all-assigned-games list; this change does not restrict that list.
