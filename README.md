# Missing Work Sheet

A Google Sheet that emails each 9th grader their missing Canvas work every Tuesday at 7am, and emails each advisor a list for their advisees. The list comes from the Students of Concern Dashboard's missing-assignments download.

Setting up a new copy of the sheet: see [apps-script/SETUP.md](apps-script/SETUP.md).

## Each week, before Tuesday 7am

1. **Download the list.** In the Students of Concern Dashboard, filter to 9th grade only, then click **Download missing assignments (CSV)**.
2. **Import it.** In the sheet, choose **Missing Work → Import CSV…**, pick the file, and click **Import**.
3. **Read the message.** It shows what was added and removed. If it says any students need an advisor, fill those in on the **Roster** tab.

The file counts as the complete list: anything not in it is treated as turned in and removed. If the import warns that it will remove a lot of rows, click **Cancel** unless you're sure the file is a full 9th-grade download.

On Tuesday at 7am, emails go out on their own. The **Log** tab records every import and send, including any errors.

## The tabs

| Tab | What's on it | Edit it? |
|---|---|---|
| Current | This week's missing work | No. Every import rewrites it. |
| Roster | 9th graders and their advisors | Yes, to fix an advisor |
| Advisors | Every student in the school and their advisor, used to fill in Roster | No. Don't delete its columns. |
| Config | Email wording and settings | Yes |
| Log | Every import and send | No |

## Common tasks

- **Change the email wording:** on Config, edit `student_subject`, `student_intro`, `advisor_subject` or `advisor_intro`. `{date}` becomes the day's date.
- **Preview the emails:** set `dry_run` to `TRUE`, then choose **Missing Work → Send digests now**. Every email goes to `dry_run_recipient`, with the real recipient shown in the subject.
- **Pause the emails:** set `dry_run` to `TRUE`. To stop them for good, go to **Extensions → Apps Script → Triggers** (clock icon) and delete the trigger.
- **Send outside the schedule:** choose **Missing Work → Send digests now**. When `dry_run` is `FALSE`, it asks you to confirm before emailing anyone.
- **Fix an advisor:** on Roster, change the student's Advisor name and Advisor email. For two advisors, put both emails in the same cell, separated by a comma.
- **You got a "Roster gaps" email:** it lists students who have missing work but couldn't be fully emailed, and why. Fix advisor problems on Roster, and those students will be included next Tuesday.

## If you send the emails (one-time setup)

Emails come from the account of whoever installs the Tuesday trigger, and replies go to that person. Only one person should install it, or everyone gets two copies.

1. On Config, set `dry_run_recipient` to your email. Leave `dry_run` set to `TRUE`.
2. Choose **Missing Work → Send digests now** and approve Google's permission request. If Google warns the app is unverified, click **Advanced**, then go to the project. Check the test emails in your inbox.
3. Choose **Missing Work → Install Tuesday 7am trigger**.
4. When you're ready to go live, set `dry_run` to `FALSE`.

Keep in mind: if nobody imports before Tuesday 7am, the emails use last week's list. And while `dry_run` is `FALSE`, anyone who clicks **Send digests now** sends real emails from their own account.

## For maintainers

- The script lives in `apps-script/`. Run the tests with `./apps-script/test-local.sh` (needs Node).
- To update a sheet's script from here, use [clasp](https://github.com/google/clasp): with `apps-script/.clasp.json` pointing at that sheet's script, run `clasp push` from `apps-script/`. Otherwise paste the files into the Apps Script editor as described in SETUP.md.
- Never commit dashboard downloads; they contain student names. `.gitignore` excludes CSV files at the repo root.
