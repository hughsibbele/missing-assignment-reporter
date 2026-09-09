# Missing Work Sheet — setup

Time: about 20 minutes, once.

## 1. Create the sheet
1. In Google Drive, create a new blank Google Sheet. Name it "Missing Work — Grade 9".
2. Menu: Extensions → Apps Script. A code editor opens in a new tab.

## 2. Paste the script
1. In the editor, delete the contents of the default `Code.gs`.
2. For each file in the `apps-script/` folder that ends in `.gs`, click the **+** next to
   "Files", choose **Script**, name it exactly as the file (without `.gs`), and paste the contents.
   Files: Config, Dates, Reconcile, Digest, Setup, Log, Import, Email, Tests.
3. Click **+** → **HTML**, name it `ImportDialog`, paste the contents of `ImportDialog.html`.
4. Click the save icon. Close the editor tab and reload the spreadsheet.

## 3. Set up the tabs
1. A **Missing Work** menu now appears. Choose **Set up sheet**.
2. Google asks you to authorize the script. Choose your school account, click through
   "Advanced → Go to (project name)" if it warns the app is unverified, and allow access to
   Sheets and Gmail. This is your own script running as you.
3. Tabs Current, Roster, Config, Log now exist.

## 4. Test with fake data
1. **Missing Work → Import CSV…**, choose `apps-script/fixtures/missing_assignments_sample.csv`.
2. Current shows 5 rows. Roster has 3 new rows with blank advisor cells.
3. In Roster, type any advisor name and *your own* email for the three fake students.
4. Confirm Config → `dry_run` is `TRUE` and `dry_run_recipient` is your email.
5. **Missing Work → Send digests now**. You receive 3 student emails and 1 advisor email,
   each subject prefixed `[DRY RUN → …]`. Adjust wording in Config and resend until happy.

## 5. Go live
1. Import the real export from the dashboard. It will warn that the file removes the fake rows;
   click **Continue**.
2. Delete the three fake rows from Roster. Fill Advisor name and Advisor email for every real
   student (Student ID and name are already there).
3. **Missing Work → Install Tuesday 7am trigger**.
4. In the Apps Script editor, open **Project Settings** (gear icon) and confirm **Time zone** is
   `(GMT-05:00) Eastern Time - New York`. The trigger fires between 7:00 and 8:00 in that zone.
5. Set Config → `dry_run` to `FALSE`.
6. Share the sheet with anyone who should see it (Viewer is enough).

## Weekly routine
- Whenever you want the list refreshed: dashboard → Download missing assignments (CSV) →
  **Missing Work → Import CSV…**. Anything not in the new file disappears from Current.
- Tuesday 7am: digests go out automatically to every student in Current who has a Roster row,
  and to every advisor with at least one advisee listed. You get a "Roster gaps" email if any
  student could not be matched.
- The Log tab shows every import and send with counts.

## Things to know
- The import must be a complete export (all students, all courses). If a file would remove
  more than half the current rows, the import asks you to confirm first.
- Rows are matched by Canvas IDs, so renaming a student or assignment in Canvas does not
  create duplicates.
- Emails send from your account. Replies come to you. Set Config → `reply_to` to change that,
  and `cc` to copy someone on every live email.
- To pause emails, set `dry_run` back to `TRUE`; the trigger keeps running but everything
  goes to you.
