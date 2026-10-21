# Google Analytics setup: age, gender and interests in /admin

This is a one-time setup, about 15 minutes, done entirely in your web browser. You do not need a terminal.

When it's finished, the website copies Google Analytics' audience totals into the admin panel once a night. Those totals cover age, gender, interests, device, city, country, traffic channel and new vs returning visitors.

Before you begin, sign in to Google with the account that owns Mir Kash's **Google Analytics** and **Firebase**.

---

## Part 1: Turn on Google Signals (this gives you age, gender and interests)

1. Go to **analytics.google.com** and open the Mir Kash property.
2. Click the **gear icon (Admin)**, bottom-left.
3. In the **Property** column, click **Data collection and modification**, then **Data collection**.
4. Find **Google signals data collection**. Click **Get started**, then **Continue**, then **Activate**. If it already says it's on, go to step 5.
5. On the same page, check that **Granular location and device data collection** is turned **on**. This gives city and device.
6. Go back to **Admin**. Under **Data display**, click **Reporting identity** and choose **Blended**. Click **Save**.

> **Age, gender and interests take a few days to appear.** Google only starts counting them after Signals is switched on. It also hides any group that is too small to keep people anonymous (Google calls this "thresholding"). For the first few days, and on quiet days, you may see "not enough data" or a group called "unknown" or "(other)". That is normal. The numbers fill in as more people visit.

---

## Part 2: Find your property ID

1. In **Admin**, in the **Property** column, click **Property details**.
2. At the top right you'll see **PROPERTY ID**: a number such as `123456789`. Copy it.

> This is **not** the code that starts with `G-` (G-FZN0YD1X1R). That code is a different number. You need the plain number.

---

## Part 3: Give the website read-only access to Google Analytics

The website reads Google Analytics through a "service account", which is a robot Google account. You don't need to create one: the website already uses one for Firebase, and Google Analytics can reuse it.

**Find its email address:**

1. Go to **console.firebase.google.com** and open the **mir-kash-web** project.
2. Click the **gear icon** next to "Project Overview", top-left, then **Project settings**.
3. Open the **Service accounts** tab.
4. Under "Firebase Admin SDK" you'll see an email ending in `.iam.gserviceaccount.com`. It should be:
   **`firebase-adminsdk-fbsvc@mir-kash-web.iam.gserviceaccount.com`**
   Copy the email shown on your screen.

**Add it to Google Analytics as a Viewer:**

1. Back in **analytics.google.com**, open **Admin**. In the **Property** column, click **Property access management**.
2. Click the blue **+** button, top-right, then **Add users**.
3. Paste the service-account email into **Email addresses**.
4. Untick **Notify new users by email**. A robot account can't read email.
5. Under **Direct roles and data restrictions**, choose **Viewer**.
6. Click **Add**, top-right.

**Switch on the Google Analytics Data API:**

The robot account belongs to a Google Cloud project. That project has to be allowed to talk to Google Analytics.

1. Open this link:
   **https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com?project=mir-kash-web**
2. Check that the project name at the top says **mir-kash-web**.
3. Click the blue **Enable** button. If it says **Manage** instead, it's already on and you're done.

---

## Part 4: Add the property ID to Vercel

1. Go to **vercel.com**, open the Mir Kash project and click **Settings**, then **Environment Variables**.
2. Add a new variable:
   - **Key:** `GA4_PROPERTY_ID`
   - **Value:** the number from Part 2, for example `123456789`
   - **Environments:** tick **Production**. Tick **Preview** too if you like.
3. Click **Save**.
4. New settings only take effect after a redeploy. Click **Deployments**. On the top (latest) deployment, click the **⋯** menu, then **Redeploy**, then **Redeploy** again.

You don't need to add a second key: the website reuses the Firebase key it already has. You would only add one (named `GA4_SERVICE_ACCOUNT`) if you ever wanted a separate robot account just for Analytics.

---

## Part 5: Check it worked (optional)

The sync runs by itself every night. To run it now instead:

1. In Vercel, open **Settings**, then **Cron Jobs**.
2. Find **/api/cron/ga-sync** and click **Run**.
3. Click **View logs**. A successful run shows `"ok": true` and a row count for each item (age, gender, device…).

**The first run copies the last 90 days.** After that, each night re-copies the last 3 days, because Google keeps adjusting recent numbers for a day or two.

**If something went wrong**, the log will say one of these:

| The log says | What to do |
|---|---|
| `GA4_PROPERTY_ID or service account not set` | Part 4: check the variable name and value, then redeploy. |
| `403 … Data API has not been used … or it is disabled` | Part 3: the **Enable** step. Wait 5 minutes after enabling, then run again. |
| `403 … does not have sufficient permissions` | Part 3: the robot email isn't a Viewer yet, or there's a typo in it. |
| Age or gender has `rows: 0` | Normal for the first few days after Part 1 (see the note there). |
