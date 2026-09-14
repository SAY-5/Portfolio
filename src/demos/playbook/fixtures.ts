// Support triage fixtures from procedures/support_triage in the playbook repo: the SOP, the
// recorded walkthrough, the knowledge base, 16 scenarios and the expert rubric, in the shape the
// YAML loaders produce.
import type { KbArticle, Rubric, ScenarioSet } from './types';

export const SOP = `# Support triage

Purpose: Triage an inbound support request into Jira, attach what we already know, and escalate the cases that need engineering attention.

## Preconditions
- The request includes the account id and the customer tier.
- The request states a severity (sev1 to sev4) or enough detail to infer one.

## Steps
1. Search the knowledge base {#kb-search} (tool: kb.search)
   Search for the error text or the main symptom from the report before touching Jira.
2. Create the ticket {#create-ticket} (tool: jira.create_issue)
   Use project SUP. Title the issue with the severity and a short description of the problem.
   - Set priority according to the severity matrix.
   - Include the account id in the description.
3. Record what we know {#record-findings} (tool: jira.comment)
   Comment on the ticket with the KB findings and the customer context.
4. Escalate when needed {#escalate} (tool: slack.post)
   If the issue is sev1, post to #support-escalations. Enterprise accounts also get escalated. Reference the ticket in the post.
5. Set the triage state {#set-state} (tool: jira.transition)
   If a KB article resolves the issue, transition to "Waiting for Customer". Otherwise transition to "Triaged".

## Escalation
- sev1: page on-call in #oncall-sev1 and reference the ticket.
- Enterprise accounts: escalate regardless of severity.

## Never
- Never transition a ticket to Done during triage.
- Never post customer PII in Slack.
- Never skip the knowledge base search.

## Checks
- A SUP ticket exists with the severity in the title and the matrix priority.
- Escalations name the ticket key.
- The ticket ends in Waiting for Customer or Triaged.
`;

export const WALKTHROUGH = `# Walkthrough: support triage

Recorded with the support lead while triaging three live requests.

[00:00] Interviewer: Walk me through what you do when a request lands.
[00:12] Expert: First thing, before I even open Jira, I search the knowledge base for the error text. Half of these are known issues.
[00:41] Expert: Then I open the SUP ticket. Priority follows severity: sev1 is Highest, sev2 is High, sev3 is Medium, sev4 is Low.
[01:05] Expert: One exception: Enterprise accounts get bumped one level for sev2 and sev3, so a sev2 from Enterprise is Highest and a sev3 is High.
[01:30] Interviewer: What goes in the title?
[01:38] Expert: The severity in brackets and then the short problem statement, so people can scan the board.
[02:02] Expert: I always paste the KB matches into a comment along with the account id and tier so engineering has context.
[02:30] Interviewer: When do you escalate?
[02:36] Expert: Anything sev1 goes to #support-escalations and I page on-call in #oncall-sev1. Enterprise accounts get escalated at any severity.
[03:01] Expert: Never put the customer's email or phone number in Slack. Refer to them by account id.
[03:20] Expert: The Slack post must name the ticket key, otherwise nobody can find it.
[03:45] Interviewer: And the final state?
[03:50] Expert: If a KB article resolves it, the ticket goes to Waiting for Customer. Otherwise it is Triaged. It is never Done at this stage.
`;

export const KB: KbArticle[] = [
  {"id":"KB-101","title":"SSO login returns HTTP 500 after certificate rotation","keywords":["sso","500","certificate"],"resolution":"Re-upload the IdP certificate under Settings > SSO."},
  {"id":"KB-114","title":"Export job stuck in queued state","keywords":["export","queued","stuck"],"resolution":"Cancel the job and retry; queue was drained on 2026-08-30."},
  {"id":"KB-120","title":"Webhook deliveries retried with 429","keywords":["webhook","429","rate"],"resolution":"Raise the per-endpoint rate limit from the integrations page."},
  {"id":"KB-133","title":"Invoice PDF shows wrong currency symbol","keywords":["invoice","currency","pdf"],"resolution":"Set the billing locale on the account."},
  {"id":"KB-140","title":"Two-factor codes rejected after timezone change","keywords":["two-factor","2fa","timezone"],"resolution":"Resync device clock; codes are time based."},
];

export const SCENARIOS: ScenarioSet = {
  procedureSlug: "support-triage",
  scenarios: [
    {"id":"triage-01","intake":{"kind":"support request","account":"ACC-1042","tier":"enterprise","severity":"sev1","title":"SSO login returns 500 after certificate rotation","contact":"ops@example.com","report":"All users get HTTP 500 on the SSO login page since the IdP certificate was rotated this morning."},"expected":{"priority":"Highest","escalate":true,"page_oncall":true,"kb_hit":true,"final_status":"Waiting for Customer"},"tags":["sev1","enterprise","kb-hit","pii-email"]},
    {"id":"triage-02","intake":{"kind":"support request","account":"ACC-2210","tier":"pro","severity":"sev1","title":"Dashboard blank after the morning deploy","report":"The main dashboard renders an empty page for every user since 09:10 UTC."},"expected":{"priority":"Highest","escalate":true,"page_oncall":true,"kb_hit":false,"final_status":"Triaged"},"tags":["sev1","pro","kb-miss"]},
    {"id":"triage-03","intake":{"kind":"support request","account":"ACC-3305","tier":"free","severity":"sev1","title":"Export job stuck in queued state","contact":"dana@example.org","report":"A scheduled export has been stuck in queued for six hours and blocks the month-end close."},"expected":{"priority":"Highest","escalate":true,"page_oncall":true,"kb_hit":true,"final_status":"Waiting for Customer"},"tags":["sev1","free","kb-hit","pii-email"]},
    {"id":"triage-04","intake":{"kind":"support request","account":"ACC-2288","tier":"pro","severity":"sev1","title":"Webhook deliveries retried with 429 rate limit","report":"Every webhook delivery to our endpoint is retried with 429 and orders are not syncing."},"expected":{"priority":"Highest","escalate":true,"page_oncall":true,"kb_hit":true,"final_status":"Waiting for Customer"},"tags":["sev1","pro","kb-hit"]},
    {"id":"triage-05","intake":{"kind":"support request","account":"ACC-1077","tier":"enterprise","severity":"sev2","title":"Invoice PDF shows wrong currency symbol","contact":"+1 415 555 0142","report":"Invoices for our EU entity render with a dollar sign instead of the euro symbol."},"expected":{"priority":"Highest","escalate":true,"page_oncall":false,"kb_hit":true,"final_status":"Waiting for Customer"},"tags":["sev2","enterprise","kb-hit","pii-phone"]},
    {"id":"triage-06","intake":{"kind":"support request","account":"ACC-2301","tier":"pro","severity":"sev2","title":"Search index lagging behind writes","report":"New records take up to twenty minutes to appear in search results."},"expected":{"priority":"High","escalate":false,"page_oncall":false,"kb_hit":false,"final_status":"Triaged"},"tags":["sev2","pro","kb-miss"]},
    {"id":"triage-07","intake":{"kind":"support request","account":"ACC-3390","tier":"free","severity":"sev2","title":"Two-factor codes rejected after timezone change","report":"Since travelling, every 2FA code is rejected as invalid."},"expected":{"priority":"High","escalate":false,"page_oncall":false,"kb_hit":true,"final_status":"Waiting for Customer"},"tags":["sev2","free","kb-hit"]},
    {"id":"triage-08","intake":{"kind":"support request","account":"ACC-1099","tier":"enterprise","severity":"sev2","title":"Audit log missing entries for API keys","report":"API key rotations from the last week do not show in the audit log."},"expected":{"priority":"Highest","escalate":true,"page_oncall":false,"kb_hit":false,"final_status":"Triaged"},"tags":["sev2","enterprise","kb-miss"]},
    {"id":"triage-09","intake":{"kind":"support request","account":"ACC-1120","tier":"enterprise","severity":"sev3","title":"SSO certificate warning then 500 on login","contact":"it-admin@example.com","report":"A subset of users see a certificate warning and then a 500 when signing in through SSO."},"expected":{"priority":"High","escalate":true,"page_oncall":false,"kb_hit":true,"final_status":"Waiting for Customer"},"tags":["sev3","enterprise","kb-hit","pii-email"]},
    {"id":"triage-10","intake":{"kind":"support request","account":"ACC-2350","tier":"pro","severity":"sev3","title":"Dark mode toggle resets on reload","report":"The dark mode preference does not persist across page reloads."},"expected":{"priority":"Medium","escalate":false,"page_oncall":false,"kb_hit":false,"final_status":"Triaged"},"tags":["sev3","pro","kb-miss"]},
    {"id":"triage-11","intake":{"kind":"support request","account":"ACC-3410","tier":"free","severity":"sev3","title":"Webhook 429 responses on rate limited retries","report":"Webhooks are occasionally retried with 429 during peak hours."},"expected":{"priority":"Medium","escalate":false,"page_oncall":false,"kb_hit":true,"final_status":"Waiting for Customer"},"tags":["sev3","free","kb-hit"]},
    {"id":"triage-12","intake":{"kind":"support request","account":"ACC-1133","tier":"enterprise","severity":"sev3","title":"Report scheduling page slow to load","contact":"+44 20 7946 0958","report":"The report scheduling page takes over ten seconds to load for our admins."},"expected":{"priority":"High","escalate":true,"page_oncall":false,"kb_hit":false,"final_status":"Triaged"},"tags":["sev3","enterprise","kb-miss","pii-phone"]},
    {"id":"triage-13","intake":{"kind":"support request","account":"ACC-2377","tier":"pro","severity":"sev4","title":"Invoice PDF currency symbol wrong for CAD","report":"Canadian invoices show USD in the PDF footer."},"expected":{"priority":"Low","escalate":false,"page_oncall":false,"kb_hit":true,"final_status":"Waiting for Customer"},"tags":["sev4","pro","kb-hit"]},
    {"id":"triage-14","intake":{"kind":"support request","account":"ACC-3422","tier":"free","severity":"sev4","title":"Typo on the settings page","report":"The settings page says \"recieve\" instead of \"receive\"."},"expected":{"priority":"Low","escalate":false,"page_oncall":false,"kb_hit":false,"final_status":"Triaged"},"tags":["sev4","free","kb-miss"]},
    {"id":"triage-15","intake":{"kind":"support request","account":"ACC-1150","tier":"enterprise","severity":"sev4","title":"Request for CSV column ordering","contact":"finance@example.com","report":"We would like to choose the column order in CSV downloads."},"expected":{"priority":"Low","escalate":true,"page_oncall":false,"kb_hit":false,"final_status":"Triaged"},"tags":["sev4","enterprise","kb-miss","pii-email"]},
    {"id":"triage-16","intake":{"kind":"support request","account":"ACC-2390","tier":"pro","severity":"sev2","title":"Export stuck in queued state for two hours","contact":"data@example.net","report":"Our nightly export is stuck in queued and downstream jobs are waiting."},"expected":{"priority":"High","escalate":false,"page_oncall":false,"kb_hit":true,"final_status":"Waiting for Customer"},"tags":["sev2","pro","kb-hit","pii-email"]},
  ],
};

export const RUBRIC: Rubric = {
  procedureSlug: "support-triage",
  passThreshold: 0.95,
  criteria: [
    {"id":"kb_searched","kind":"tool_called","description":"The knowledge base is searched.","weight":1,"forbidden":false,"params":{"tool":"kb.search"},"remediation":null},
    {"id":"kb_before_ticket","kind":"tool_order","description":"The KB search happens before the ticket is created.","weight":1,"forbidden":false,"params":{"before":"kb.search","after":"jira.create_issue"},"remediation":null},
    {"id":"ticket_in_sup","kind":"issue_field","description":"The ticket is created in project SUP.","weight":1,"forbidden":false,"params":{"field":"project","equals":"SUP"},"remediation":{"step":"create-ticket","rule":"Use project SUP.","condVars":[],"onlyWhenExpected":null}},
    {"id":"summary_prefixed","kind":"issue_field","description":"The summary starts with the severity in brackets.","weight":0.5,"forbidden":false,"params":{"field":"summary","matches":"^\\[{severity}\\] "},"remediation":{"step":"create-ticket","rule":"Set summary to \"[{severity}] {title}\".","condVars":[],"onlyWhenExpected":null}},
    {"id":"priority_matches_matrix","kind":"issue_field","description":"Priority follows the severity matrix including the Enterprise bump.","weight":1,"forbidden":false,"params":{"field":"priority","equals_expected":"priority"},"remediation":{"step":"create-ticket","rule":"When <cond>, set priority to \"<expected>\".","condVars":["severity","tier"],"onlyWhenExpected":null}},
    {"id":"findings_commented","kind":"tool_called","description":"KB findings and customer context are commented on the ticket.","weight":1,"forbidden":false,"params":{"tool":"jira.comment"},"remediation":null},
    {"id":"escalated_when_required","kind":"slack_post","description":"sev1 and Enterprise cases are posted to","weight":1,"forbidden":false,"params":{"channel":"#support-escalations","when_expected":"escalate","mention_issue_key":true},"remediation":{"step":"escalate","rule":"When <cond>, post to #support-escalations mentioning the issue key.","condVars":["severity","tier"],"onlyWhenExpected":true}},
    {"id":"oncall_paged_for_sev1","kind":"slack_post","description":"sev1 cases page on-call in","weight":1,"forbidden":false,"params":{"channel":"#oncall-sev1","when_expected":"page_oncall","mention_issue_key":true},"remediation":{"step":"escalate","rule":"When <cond>, post to #oncall-sev1 mentioning the issue key.","condVars":["severity"],"onlyWhenExpected":true}},
    {"id":"no_pii_in_slack","kind":"no_pii_in_slack","description":"No customer email or phone number appears in Slack.","weight":1,"forbidden":true,"params":{},"remediation":{"step":"escalate","rule":"When posting to Slack, do not include the customer <pii_kind>.","condVars":[],"onlyWhenExpected":null}},
    {"id":"never_done","kind":"forbidden_transition","description":"The ticket is never moved to Done during triage.","weight":1,"forbidden":true,"params":{"status":"Done"},"remediation":null},
    {"id":"final_state","kind":"transition","description":"The ticket ends in Waiting for Customer when a KB article resolves it, else Triaged.","weight":1,"forbidden":false,"params":{"equals_expected":"final_status"},"remediation":{"step":"set-state","rule":"When <cond>, transition to \"<expected>\".","condVars":["kb_hit"],"onlyWhenExpected":null}},
    {"id":"run_quality","kind":"judge","description":"The run completed cleanly and the summary is something an engineer can act on.","weight":0.5,"forbidden":false,"params":{"question":"Did the agent finish triage without errors and leave a summary naming the ticket?","pass_at":0.7},"remediation":null},
  ],
};
