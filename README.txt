ARAB Games Workflow - Cleaned Package

Included:
- views/games/index.ejs
- views/games/assign.ejs
- views/games/assigned.ejs
- routes/games.js

Cleanup performed:
- Preserved the supplied working markup, styling, JavaScript, form names,
  route paths, database field names, and workflow.
- Normalized line endings and trailing whitespace only.
- No design or functionality was intentionally changed.

Important:
The supplied games.js contains:
  res.redirect('/assigned-games')
after a successful assignment.

The supplied games.js excerpt does not define a /assigned-games GET route.
If that route is already in another route file in your project, keep it there.
Do not add a duplicate route until we inspect the existing route.
