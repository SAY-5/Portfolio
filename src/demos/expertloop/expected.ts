// The golden fixtures and README blocks of SAY-5/expertloop at
// 2b539b64950c98843079ed1c89574ae7a1c681a6: samples/expected/compiled_refund.json, compiled_onboarding.json,
// compiled_incident.json, compiled_phrasings.json, traces.json, demo_summary.json,
// README.md lines 97-106 (the run section) and 108-118 (the summary block). Copied
// verbatim by a scratch script; the lab compares what the port produces with these
// values and the page reports the result.

export const SOURCE_COMMIT = '2b539b64950c98843079ed1c89574ae7a1c681a6';
export const SOURCE_COMMIT_SHORT = '2b539b6';

export type FixtureKey = 'refund' | 'onboarding' | 'incident';

/** compile_note(sample, note_id=1, name=title) as written by tests/test_golden.py. */
export const EXPECTED_COMPILED: Record<FixtureKey, unknown> = {
  "refund": {
    "agent_prompt": "# Refund handling for online orders\n\nBefore starting, confirm:\n- Confirm the order is within the 30-day return window (see doc:policy/refunds-v4)\n- Confirm the payment was captured, not just authorised, in Stripe\n\nFollow these steps in order:\n1. Look up the order in OrderDB by order number and verify the customer email matches the ticket (tool: OrderDB)\n2. Check the return reason against the accepted reasons list in doc:policy/refunds-v4\n   - if reason is fraud: escalate to the risk team and stop\n3. Confirm the item was received back in the warehouse (tool: OrderDB)\n   - expected: warehouse scan present in OrderDB\n4. Issue the refund in Stripe for the captured amount (tool: Stripe)\n5. Reply to the customer in Zendesk with the refund confirmation number See ticket FIN-2210 for the reply template (tool: Zendesk)\n   - expected: the ticket can be closed\n\nNever:\n- refund to a different card than the one charged\n- issue store credit instead of a refund unless the customer asks for it in writing\n\nDone when:\n- Refund appears as succeeded in Stripe and the Zendesk ticket is solved",
    "decision_rules": [],
    "forbidden_actions": [
      {
        "citations": [
          {
            "line_end": 21,
            "line_start": 21,
            "note_id": 1
          }
        ],
        "text": "refund to a different card than the one charged"
      },
      {
        "citations": [
          {
            "line_end": 22,
            "line_start": 22,
            "note_id": 1
          }
        ],
        "text": "issue store credit instead of a refund unless the customer asks for it in writing"
      }
    ],
    "name": "Refund handling for online orders",
    "outcomes": [
      {
        "citations": [
          {
            "line_end": 25,
            "line_start": 25,
            "note_id": 1
          }
        ],
        "text": "Refund appears as succeeded in Stripe and the Zendesk ticket is solved"
      }
    ],
    "preconditions": [
      {
        "citations": [
          {
            "line_end": 4,
            "line_start": 4,
            "note_id": 1
          },
          {
            "line_end": 4,
            "line_start": 4,
            "note_id": 1,
            "source_kind": "doc",
            "source_ref": "policy/refunds-v4"
          }
        ],
        "text": "Confirm the order is within the 30-day return window (see doc:policy/refunds-v4)"
      },
      {
        "citations": [
          {
            "line_end": 5,
            "line_start": 5,
            "note_id": 1
          }
        ],
        "text": "Confirm the payment was captured, not just authorised, in Stripe"
      }
    ],
    "sources": [
      {
        "kind": "doc",
        "ref": "policy/refunds-v4"
      },
      {
        "kind": "ticket",
        "ref": "FIN-2210"
      }
    ],
    "steps": [
      {
        "action": "Look up the order in OrderDB by order number and verify the customer email matches the ticket",
        "citations": [
          {
            "line_end": 13,
            "line_start": 13,
            "note_id": 1
          }
        ],
        "condition": null,
        "decision_rules": [],
        "expected_outcome": null,
        "forbidden": [],
        "halts": false,
        "id": "s1",
        "order": 1,
        "tool": "OrderDB"
      },
      {
        "action": "Check the return reason against the accepted reasons list in doc:policy/refunds-v4",
        "citations": [
          {
            "line_end": 15,
            "line_start": 14,
            "note_id": 1
          },
          {
            "line_end": 15,
            "line_start": 14,
            "note_id": 1,
            "source_kind": "doc",
            "source_ref": "policy/refunds-v4"
          }
        ],
        "condition": null,
        "decision_rules": [
          {
            "condition": "reason is fraud",
            "halts": true,
            "then": "escalate to the risk team and stop"
          }
        ],
        "expected_outcome": null,
        "forbidden": [],
        "halts": false,
        "id": "s2",
        "order": 2,
        "tool": null
      },
      {
        "action": "Confirm the item was received back in the warehouse",
        "citations": [
          {
            "line_end": 16,
            "line_start": 16,
            "note_id": 1
          }
        ],
        "condition": null,
        "decision_rules": [],
        "expected_outcome": "warehouse scan present in OrderDB",
        "forbidden": [],
        "halts": false,
        "id": "s3",
        "order": 3,
        "tool": "OrderDB"
      },
      {
        "action": "Issue the refund in Stripe for the captured amount",
        "citations": [
          {
            "line_end": 17,
            "line_start": 17,
            "note_id": 1
          }
        ],
        "condition": null,
        "decision_rules": [],
        "expected_outcome": null,
        "forbidden": [],
        "halts": false,
        "id": "s4",
        "order": 4,
        "tool": "Stripe"
      },
      {
        "action": "Reply to the customer in Zendesk with the refund confirmation number See ticket FIN-2210 for the reply template",
        "citations": [
          {
            "line_end": 18,
            "line_start": 18,
            "note_id": 1
          },
          {
            "line_end": 18,
            "line_start": 18,
            "note_id": 1,
            "source_kind": "ticket",
            "source_ref": "FIN-2210"
          }
        ],
        "condition": null,
        "decision_rules": [],
        "expected_outcome": "the ticket can be closed",
        "forbidden": [],
        "halts": false,
        "id": "s5",
        "order": 5,
        "tool": "Zendesk"
      }
    ],
    "title": "Refund handling for online orders",
    "tools": [
      "Stripe",
      "Zendesk",
      "OrderDB"
    ]
  },
  "onboarding": {
    "agent_prompt": "# New engineer onboarding checklist\n\nBefore starting, confirm:\n- HR has marked the hire as started in Workday\n- Manager has filled the access request form at https://intranet.example.com/forms/access-request\n\nFollow these steps in order:\n1. Create the Okta account using the corporate email from Workday (tool: Okta)\n2. Add the account to the engineering group in Okta (tool: Okta)\n   - expected: GitHub and Jira SSO work\n3. Invite the GitHub user to the organisation with the team listed in the access request form (tool: GitHub)\n   - if the role is contractor: invite as an outside collaborator on the named repositories only\n4. Add the person to the #eng-announcements and team channels in Slack (tool: Slack)\n5. Create the onboarding epic in Jira from template ONB-100 and assign it to the new hire (tool: Jira)\n6. Send the welcome message in Slack with the links from doc:onboarding/week-one (tool: Slack)\n\nDecision rules:\n- if the start date is more than 7 days away: stop and schedule the checklist for the start date\n\nNever:\n- grant admin roles during onboarding\n- share credentials over Slack\n\nDone when:\n- The new hire can open GitHub, Jira and Slack through Okta",
    "decision_rules": [
      {
        "citations": [
          {
            "line_end": 23,
            "line_start": 23,
            "note_id": 1
          }
        ],
        "condition": "the start date is more than 7 days away",
        "halts": true,
        "then": "stop and schedule the checklist for the start date"
      }
    ],
    "forbidden_actions": [
      {
        "citations": [
          {
            "line_end": 26,
            "line_start": 26,
            "note_id": 1
          }
        ],
        "text": "grant admin roles during onboarding"
      },
      {
        "citations": [
          {
            "line_end": 27,
            "line_start": 27,
            "note_id": 1
          }
        ],
        "text": "share credentials over Slack"
      }
    ],
    "name": "New engineer onboarding checklist",
    "outcomes": [
      {
        "citations": [
          {
            "line_end": 30,
            "line_start": 30,
            "note_id": 1
          }
        ],
        "text": "The new hire can open GitHub, Jira and Slack through Okta"
      }
    ],
    "preconditions": [
      {
        "citations": [
          {
            "line_end": 4,
            "line_start": 4,
            "note_id": 1
          }
        ],
        "text": "HR has marked the hire as started in Workday"
      },
      {
        "citations": [
          {
            "line_end": 5,
            "line_start": 5,
            "note_id": 1
          },
          {
            "line_end": 5,
            "line_start": 5,
            "note_id": 1,
            "source_kind": "url",
            "source_ref": "https://intranet.example.com/forms/access-request"
          }
        ],
        "text": "Manager has filled the access request form at https://intranet.example.com/forms/access-request"
      }
    ],
    "sources": [
      {
        "kind": "url",
        "ref": "https://intranet.example.com/forms/access-request"
      },
      {
        "kind": "ticket",
        "ref": "ONB-100"
      },
      {
        "kind": "doc",
        "ref": "onboarding/week-one"
      }
    ],
    "steps": [
      {
        "action": "Create the Okta account using the corporate email from Workday",
        "citations": [
          {
            "line_end": 14,
            "line_start": 14,
            "note_id": 1
          }
        ],
        "condition": null,
        "decision_rules": [],
        "expected_outcome": null,
        "forbidden": [],
        "halts": false,
        "id": "s1",
        "order": 1,
        "tool": "Okta"
      },
      {
        "action": "Add the account to the engineering group in Okta",
        "citations": [
          {
            "line_end": 15,
            "line_start": 15,
            "note_id": 1
          }
        ],
        "condition": null,
        "decision_rules": [],
        "expected_outcome": "GitHub and Jira SSO work",
        "forbidden": [],
        "halts": false,
        "id": "s2",
        "order": 2,
        "tool": "Okta"
      },
      {
        "action": "Invite the GitHub user to the organisation with the team listed in the access request form",
        "citations": [
          {
            "line_end": 17,
            "line_start": 16,
            "note_id": 1
          }
        ],
        "condition": null,
        "decision_rules": [
          {
            "condition": "the role is contractor",
            "halts": false,
            "then": "invite as an outside collaborator on the named repositories only"
          }
        ],
        "expected_outcome": null,
        "forbidden": [],
        "halts": false,
        "id": "s3",
        "order": 3,
        "tool": "GitHub"
      },
      {
        "action": "Add the person to the #eng-announcements and team channels in Slack",
        "citations": [
          {
            "line_end": 18,
            "line_start": 18,
            "note_id": 1
          }
        ],
        "condition": null,
        "decision_rules": [],
        "expected_outcome": null,
        "forbidden": [],
        "halts": false,
        "id": "s4",
        "order": 4,
        "tool": "Slack"
      },
      {
        "action": "Create the onboarding epic in Jira from template ONB-100 and assign it to the new hire",
        "citations": [
          {
            "line_end": 19,
            "line_start": 19,
            "note_id": 1
          },
          {
            "line_end": 19,
            "line_start": 19,
            "note_id": 1,
            "source_kind": "ticket",
            "source_ref": "ONB-100"
          }
        ],
        "condition": null,
        "decision_rules": [],
        "expected_outcome": null,
        "forbidden": [],
        "halts": false,
        "id": "s5",
        "order": 5,
        "tool": "Jira"
      },
      {
        "action": "Send the welcome message in Slack with the links from doc:onboarding/week-one",
        "citations": [
          {
            "line_end": 20,
            "line_start": 20,
            "note_id": 1
          },
          {
            "line_end": 20,
            "line_start": 20,
            "note_id": 1,
            "source_kind": "doc",
            "source_ref": "onboarding/week-one"
          }
        ],
        "condition": null,
        "decision_rules": [],
        "expected_outcome": null,
        "forbidden": [],
        "halts": false,
        "id": "s6",
        "order": 6,
        "tool": "Slack"
      }
    ],
    "title": "New engineer onboarding checklist",
    "tools": [
      "Okta",
      "GitHub",
      "Slack",
      "Jira"
    ]
  },
  "incident": {
    "agent_prompt": "# Incident triage for production alerts\n\nBefore starting, confirm:\n- The alert came from the production PagerDuty service, see https://status.example.com/runbooks/triage\n- You are the on-call engineer listed in PagerDuty\n\nFollow these steps in order:\n1. Acknowledge the alert in PagerDuty within 5 minutes (tool: PagerDuty)\n2. Open the service dashboard in Grafana and check error rate and latency for the last 30 minutes (tool: Grafana)\n3. Only if error rate exceeds 5 percent: declare a SEV1 in Slack and page the service owner (tool: Slack)\n4. Only if error rate is under 5 percent: post a status update in the #incidents Slack channel (tool: Slack)\n5. Create the incident ticket in Jira from template INC-77 with the alert link and the dashboard screenshot (tool: Jira)\n6. Mitigate using the runbook in doc:runbooks/service-triage\n   - expected: error rate back under 1 percent\n7. Resolve the PagerDuty alert and link the Jira ticket in the resolution note (tool: PagerDuty)\n\nNever:\n- restart the database cluster without the service owner on the call\n- close the alert before the Jira ticket exists\n\nDone when:\n- The alert is resolved in PagerDuty and the Jira ticket links the timeline",
    "decision_rules": [],
    "forbidden_actions": [
      {
        "citations": [
          {
            "line_end": 23,
            "line_start": 23,
            "note_id": 1
          }
        ],
        "text": "restart the database cluster without the service owner on the call"
      },
      {
        "citations": [
          {
            "line_end": 24,
            "line_start": 24,
            "note_id": 1
          }
        ],
        "text": "close the alert before the Jira ticket exists"
      }
    ],
    "name": "Incident triage for production alerts",
    "outcomes": [
      {
        "citations": [
          {
            "line_end": 27,
            "line_start": 27,
            "note_id": 1
          }
        ],
        "text": "The alert is resolved in PagerDuty and the Jira ticket links the timeline"
      }
    ],
    "preconditions": [
      {
        "citations": [
          {
            "line_end": 4,
            "line_start": 4,
            "note_id": 1
          },
          {
            "line_end": 4,
            "line_start": 4,
            "note_id": 1,
            "source_kind": "url",
            "source_ref": "https://status.example.com/runbooks/triage"
          }
        ],
        "text": "The alert came from the production PagerDuty service, see https://status.example.com/runbooks/triage"
      },
      {
        "citations": [
          {
            "line_end": 5,
            "line_start": 5,
            "note_id": 1
          }
        ],
        "text": "You are the on-call engineer listed in PagerDuty"
      }
    ],
    "sources": [
      {
        "kind": "url",
        "ref": "https://status.example.com/runbooks/triage"
      },
      {
        "kind": "ticket",
        "ref": "INC-77"
      },
      {
        "kind": "doc",
        "ref": "runbooks/service-triage"
      }
    ],
    "steps": [
      {
        "action": "Acknowledge the alert in PagerDuty within 5 minutes",
        "citations": [
          {
            "line_end": 14,
            "line_start": 14,
            "note_id": 1
          }
        ],
        "condition": null,
        "decision_rules": [],
        "expected_outcome": null,
        "forbidden": [],
        "halts": false,
        "id": "s1",
        "order": 1,
        "tool": "PagerDuty"
      },
      {
        "action": "Open the service dashboard in Grafana and check error rate and latency for the last 30 minutes",
        "citations": [
          {
            "line_end": 15,
            "line_start": 15,
            "note_id": 1
          }
        ],
        "condition": null,
        "decision_rules": [],
        "expected_outcome": null,
        "forbidden": [],
        "halts": false,
        "id": "s2",
        "order": 2,
        "tool": "Grafana"
      },
      {
        "action": "declare a SEV1 in Slack and page the service owner",
        "citations": [
          {
            "line_end": 16,
            "line_start": 16,
            "note_id": 1
          }
        ],
        "condition": "error rate exceeds 5 percent",
        "decision_rules": [],
        "expected_outcome": null,
        "forbidden": [],
        "halts": false,
        "id": "s3",
        "order": 3,
        "tool": "Slack"
      },
      {
        "action": "post a status update in the #incidents Slack channel",
        "citations": [
          {
            "line_end": 17,
            "line_start": 17,
            "note_id": 1
          }
        ],
        "condition": "error rate is under 5 percent",
        "decision_rules": [],
        "expected_outcome": null,
        "forbidden": [],
        "halts": false,
        "id": "s4",
        "order": 4,
        "tool": "Slack"
      },
      {
        "action": "Create the incident ticket in Jira from template INC-77 with the alert link and the dashboard screenshot",
        "citations": [
          {
            "line_end": 18,
            "line_start": 18,
            "note_id": 1
          },
          {
            "line_end": 18,
            "line_start": 18,
            "note_id": 1,
            "source_kind": "ticket",
            "source_ref": "INC-77"
          }
        ],
        "condition": null,
        "decision_rules": [],
        "expected_outcome": null,
        "forbidden": [],
        "halts": false,
        "id": "s5",
        "order": 5,
        "tool": "Jira"
      },
      {
        "action": "Mitigate using the runbook in doc:runbooks/service-triage",
        "citations": [
          {
            "line_end": 19,
            "line_start": 19,
            "note_id": 1
          },
          {
            "line_end": 19,
            "line_start": 19,
            "note_id": 1,
            "source_kind": "doc",
            "source_ref": "runbooks/service-triage"
          }
        ],
        "condition": null,
        "decision_rules": [],
        "expected_outcome": "error rate back under 1 percent",
        "forbidden": [],
        "halts": false,
        "id": "s6",
        "order": 6,
        "tool": null
      },
      {
        "action": "Resolve the PagerDuty alert and link the Jira ticket in the resolution note",
        "citations": [
          {
            "line_end": 20,
            "line_start": 20,
            "note_id": 1
          }
        ],
        "condition": null,
        "decision_rules": [],
        "expected_outcome": null,
        "forbidden": [],
        "halts": false,
        "id": "s7",
        "order": 7,
        "tool": "PagerDuty"
      }
    ],
    "title": "Incident triage for production alerts",
    "tools": [
      "PagerDuty",
      "Grafana",
      "Slack",
      "Jira"
    ]
  }
};

/** The phrasings note that exercises guards, negated stop words and unless. */
export const EXPECTED_PHRASINGS: { note: string; document: unknown } = {
  "document": {
    "agent_prompt": "# Warehouse dispatch phrasings\n\nBefore starting, confirm:\n- The order is paid and the pick list is printed\n\nFollow these steps in order:\n1. Wait for the warehouse scan\n   - expected: it is present\n2. Confirm the packing slip\n   - expected: the scan lands\n3. Answer the customer ticket and do not escalate to the risk team\n4. Issue the refund unless the order is flagged\n5. Only if the scan is present: ship the parcel, otherwise hold it\n6. Book the courier in ShipStation (tool: OrderDB)\n   - if the courier is unavailable: hand off to the dispatch desk\n   - expected: tracking number recorded in OrderDB\n\nNever:\n- dispatch without a printed label\n- escalate to the risk team\n\nDone when:\n- The parcel is scanned out and the tracking number is in OrderDB",
    "decision_rules": [],
    "forbidden_actions": [
      {
        "citations": [
          {
            "line_end": 20,
            "line_start": 20,
            "note_id": 1
          }
        ],
        "text": "dispatch without a printed label"
      },
      {
        "citations": [
          {
            "line_end": 13,
            "line_start": 13,
            "note_id": 1
          }
        ],
        "text": "escalate to the risk team"
      }
    ],
    "name": "Warehouse dispatch phrasings",
    "outcomes": [
      {
        "citations": [
          {
            "line_end": 23,
            "line_start": 23,
            "note_id": 1
          }
        ],
        "text": "The parcel is scanned out and the tracking number is in OrderDB"
      }
    ],
    "preconditions": [
      {
        "citations": [
          {
            "line_end": 4,
            "line_start": 4,
            "note_id": 1
          }
        ],
        "text": "The order is paid and the pick list is printed"
      }
    ],
    "sources": [],
    "steps": [
      {
        "action": "Wait for the warehouse scan",
        "citations": [
          {
            "line_end": 11,
            "line_start": 11,
            "note_id": 1
          }
        ],
        "condition": null,
        "decision_rules": [],
        "expected_outcome": "it is present",
        "forbidden": [],
        "halts": false,
        "id": "s1",
        "order": 1,
        "tool": null
      },
      {
        "action": "Confirm the packing slip",
        "citations": [
          {
            "line_end": 12,
            "line_start": 12,
            "note_id": 1
          }
        ],
        "condition": null,
        "decision_rules": [],
        "expected_outcome": "the scan lands",
        "forbidden": [],
        "halts": false,
        "id": "s2",
        "order": 2,
        "tool": null
      },
      {
        "action": "Answer the customer ticket and do not escalate to the risk team",
        "citations": [
          {
            "line_end": 13,
            "line_start": 13,
            "note_id": 1
          }
        ],
        "condition": null,
        "decision_rules": [],
        "expected_outcome": null,
        "forbidden": [
          "escalate to the risk team"
        ],
        "halts": false,
        "id": "s3",
        "order": 3,
        "tool": null
      },
      {
        "action": "Issue the refund unless the order is flagged",
        "citations": [
          {
            "line_end": 14,
            "line_start": 14,
            "note_id": 1
          }
        ],
        "condition": null,
        "decision_rules": [],
        "expected_outcome": null,
        "forbidden": [],
        "halts": false,
        "id": "s4",
        "order": 4,
        "tool": null
      },
      {
        "action": "ship the parcel, otherwise hold it",
        "citations": [
          {
            "line_end": 15,
            "line_start": 15,
            "note_id": 1
          }
        ],
        "condition": "the scan is present",
        "decision_rules": [],
        "expected_outcome": null,
        "forbidden": [],
        "halts": false,
        "id": "s5",
        "order": 5,
        "tool": null
      },
      {
        "action": "Book the courier in ShipStation",
        "citations": [
          {
            "line_end": 17,
            "line_start": 16,
            "note_id": 1
          }
        ],
        "condition": null,
        "decision_rules": [
          {
            "condition": "the courier is unavailable",
            "halts": true,
            "then": "hand off to the dispatch desk"
          }
        ],
        "expected_outcome": "tracking number recorded in OrderDB",
        "forbidden": [],
        "halts": false,
        "id": "s6",
        "order": 6,
        "tool": "OrderDB"
      }
    ],
    "title": "Warehouse dispatch phrasings",
    "tools": [
      "OrderDB",
      "ShipStation"
    ]
  },
  "note": "# Warehouse dispatch phrasings\n\n## Before you start\n- The order is paid and the pick list is printed.\n\n## Tools\n- OrderDB\n- ShipStation\n\n## Steps\n1. Wait for the warehouse scan and do not proceed until it is present.\n2. Confirm the packing slip and must not proceed before the scan lands.\n3. Answer the customer ticket and do not escalate to the risk team.\n4. Issue the refund unless the order is flagged.\n5. If the scan is present, ship the parcel, otherwise hold it.\n6. Book the courier in ShipStation, expected: tracking number recorded in OrderDB.\n   If the courier is unavailable, hand off to the dispatch desk.\n\n## Never\n- Never dispatch without a printed label.\n\n## Done when\n- The parcel is scanned out and the tracking number is in OrderDB.\n"
};

/** run_test_case traces for the eight demo cases, in demo order. */
export const EXPECTED_TRACES: Record<FixtureKey, unknown[]> = {
  "incident": [
    {
      "failures": [],
      "name": "high error rate declares a SEV1",
      "passed": true,
      "trace": {
        "actions": [
          "Acknowledge the alert in PagerDuty within 5 minutes",
          "Open the service dashboard in Grafana and check error rate and latency for the last 30 minutes",
          "declare a SEV1 in Slack and page the service owner",
          "Create the incident ticket in Jira from template INC-77 with the alert link and the dashboard screenshot",
          "Mitigate using the runbook in doc:runbooks/service-triage",
          "Resolve the PagerDuty alert and link the Jira ticket in the resolution note"
        ],
        "halted_at": null,
        "outcomes": [
          "error rate back under 1 percent",
          "The alert is resolved in PagerDuty and the Jira ticket links the timeline"
        ],
        "rules_fired": [],
        "rules_fired_ids": [],
        "skipped": [
          "s4"
        ],
        "steps_executed": [
          "s1",
          "s2",
          "s3",
          "s5",
          "s6",
          "s7"
        ],
        "tool_calls": [
          "PagerDuty",
          "Grafana",
          "Slack",
          "Jira",
          "PagerDuty"
        ]
      }
    },
    {
      "failures": [],
      "name": "low error rate posts a status update",
      "passed": true,
      "trace": {
        "actions": [
          "Acknowledge the alert in PagerDuty within 5 minutes",
          "Open the service dashboard in Grafana and check error rate and latency for the last 30 minutes",
          "post a status update in the #incidents Slack channel",
          "Create the incident ticket in Jira from template INC-77 with the alert link and the dashboard screenshot",
          "Mitigate using the runbook in doc:runbooks/service-triage",
          "Resolve the PagerDuty alert and link the Jira ticket in the resolution note"
        ],
        "halted_at": null,
        "outcomes": [
          "error rate back under 1 percent",
          "The alert is resolved in PagerDuty and the Jira ticket links the timeline"
        ],
        "rules_fired": [],
        "rules_fired_ids": [],
        "skipped": [
          "s3"
        ],
        "steps_executed": [
          "s1",
          "s2",
          "s4",
          "s5",
          "s6",
          "s7"
        ],
        "tool_calls": [
          "PagerDuty",
          "Grafana",
          "Slack",
          "Jira",
          "PagerDuty"
        ]
      }
    }
  ],
  "onboarding": [
    {
      "failures": [],
      "name": "contractor gets outside collaborator invite",
      "passed": true,
      "trace": {
        "actions": [
          "Create the Okta account using the corporate email from Workday",
          "Add the account to the engineering group in Okta",
          "invite as an outside collaborator on the named repositories only",
          "Invite the GitHub user to the organisation with the team listed in the access request form",
          "Add the person to the #eng-announcements and team channels in Slack",
          "Create the onboarding epic in Jira from template ONB-100 and assign it to the new hire",
          "Send the welcome message in Slack with the links from doc:onboarding/week-one"
        ],
        "halted_at": null,
        "outcomes": [
          "GitHub and Jira SSO work",
          "The new hire can open GitHub, Jira and Slack through Okta"
        ],
        "rules_fired": [
          "s3: if the role is contractor then invite as an outside collaborator on the named repositories only"
        ],
        "rules_fired_ids": [
          "s3:0"
        ],
        "skipped": [],
        "steps_executed": [
          "s1",
          "s2",
          "s3",
          "s4",
          "s5",
          "s6"
        ],
        "tool_calls": [
          "Okta",
          "Okta",
          "GitHub",
          "Slack",
          "Jira",
          "Slack"
        ]
      }
    },
    {
      "failures": [],
      "name": "far start date halts the checklist",
      "passed": true,
      "trace": {
        "actions": [
          "stop and schedule the checklist for the start date"
        ],
        "halted_at": "global",
        "outcomes": [],
        "rules_fired": [
          "global: if the start date is more than 7 days away then stop and schedule the checklist for the start date"
        ],
        "rules_fired_ids": [
          "global:0"
        ],
        "skipped": [],
        "steps_executed": [],
        "tool_calls": []
      }
    },
    {
      "failures": [],
      "name": "never grants admin",
      "passed": true,
      "trace": {
        "actions": [
          "Create the Okta account using the corporate email from Workday",
          "Add the account to the engineering group in Okta",
          "Invite the GitHub user to the organisation with the team listed in the access request form",
          "Add the person to the #eng-announcements and team channels in Slack",
          "Create the onboarding epic in Jira from template ONB-100 and assign it to the new hire",
          "Send the welcome message in Slack with the links from doc:onboarding/week-one"
        ],
        "halted_at": null,
        "outcomes": [
          "GitHub and Jira SSO work",
          "The new hire can open GitHub, Jira and Slack through Okta"
        ],
        "rules_fired": [],
        "rules_fired_ids": [],
        "skipped": [],
        "steps_executed": [
          "s1",
          "s2",
          "s3",
          "s4",
          "s5",
          "s6"
        ],
        "tool_calls": [
          "Okta",
          "Okta",
          "GitHub",
          "Slack",
          "Jira",
          "Slack"
        ]
      }
    }
  ],
  "refund": [
    {
      "failures": [],
      "name": "fraud escalates to the risk team",
      "passed": true,
      "trace": {
        "actions": [
          "Look up the order in OrderDB by order number and verify the customer email matches the ticket",
          "escalate to the risk team and stop"
        ],
        "halted_at": "s2",
        "outcomes": [],
        "rules_fired": [
          "s2: if reason is fraud then escalate to the risk team and stop"
        ],
        "rules_fired_ids": [
          "s2:0"
        ],
        "skipped": [],
        "steps_executed": [
          "s1"
        ],
        "tool_calls": [
          "OrderDB"
        ]
      }
    },
    {
      "failures": [],
      "name": "standard refund completes",
      "passed": true,
      "trace": {
        "actions": [
          "Look up the order in OrderDB by order number and verify the customer email matches the ticket",
          "Check the return reason against the accepted reasons list in doc:policy/refunds-v4",
          "Confirm the item was received back in the warehouse",
          "Issue the refund in Stripe for the captured amount",
          "Reply to the customer in Zendesk with the refund confirmation number See ticket FIN-2210 for the reply template"
        ],
        "halted_at": null,
        "outcomes": [
          "warehouse scan present in OrderDB",
          "the ticket can be closed",
          "Refund appears as succeeded in Stripe and the Zendesk ticket is solved"
        ],
        "rules_fired": [],
        "rules_fired_ids": [],
        "skipped": [],
        "steps_executed": [
          "s1",
          "s2",
          "s3",
          "s4",
          "s5"
        ],
        "tool_calls": [
          "OrderDB",
          "OrderDB",
          "Stripe",
          "Zendesk"
        ]
      }
    },
    {
      "failures": [
        "required action not taken: 'manager'",
        "forbidden action taken: 'Issue the refund'",
        "execution was expected to halt but ran to completion"
      ],
      "name": "high value refund needs manager approval",
      "passed": false,
      "trace": {
        "actions": [
          "Look up the order in OrderDB by order number and verify the customer email matches the ticket",
          "Check the return reason against the accepted reasons list in doc:policy/refunds-v4",
          "Confirm the item was received back in the warehouse",
          "Issue the refund in Stripe for the captured amount",
          "Reply to the customer in Zendesk with the refund confirmation number See ticket FIN-2210 for the reply template"
        ],
        "halted_at": null,
        "outcomes": [
          "warehouse scan present in OrderDB",
          "the ticket can be closed",
          "Refund appears as succeeded in Stripe and the Zendesk ticket is solved"
        ],
        "rules_fired": [],
        "rules_fired_ids": [],
        "skipped": [],
        "steps_executed": [
          "s1",
          "s2",
          "s3",
          "s4",
          "s5"
        ],
        "tool_calls": [
          "OrderDB",
          "OrderDB",
          "Stripe",
          "Zendesk"
        ]
      }
    }
  ]
};

/** samples/expected/demo_summary.json, summary_block. */
export const EXPECTED_DEMO_SUMMARY = "== Summary\n  notes ingested:        3\n  steps compiled:        18\n  citations linked:      26 (18/18 steps cited, 100%)\n  edits recorded:        3\n  approvals:             7 (changes requested: 1)\n  test runs:             5 (4 green, 1 red; 13 cases passed, 1 failed)\n  publishes blocked:     1\n  publishes delivered:   8 deliveries (4 versions to 2 targets), rollbacks: 1\n  receipts:              5 webhook (signed), 5 Jira comments, 5 Jira attachments\n  states:                set 1=published (live v2), set 2=published (live v1), set 3=published (live v2)";

/** README.md lines 97-106: the run section make demo prints. */
export const README_RUN = "== Running test cases and publishing approved sets\n  set 2 v1: PASSED (3 passed, 0 failed)\n  set 3 v2: PASSED (2 passed, 0 failed)\n  set 1 v1: FAILED (2 passed, 1 failed)\n    FAIL high value refund needs manager approval: required action not taken: 'manager'; forbidden action taken: 'Issue the refund'; execution was expected to halt but ran to completion\n  set 2 v1: delivered to webhook (receipt whr-1)\n  set 2 v1: delivered to jira (receipt 10002)\n  set 3 v2: delivered to webhook (receipt whr-4)\n  set 3 v2: delivered to jira (receipt 10005)\n  set 1: publish BLOCKED: publish blocked: failing test cases: high value refund needs manager approval";

/** README.md lines 108-118: the summary block make demo prints. */
export const README_SUMMARY = "== Summary\n  notes ingested:        3\n  steps compiled:        18\n  citations linked:      26 (18/18 steps cited, 100%)\n  edits recorded:        3\n  approvals:             7 (changes requested: 1)\n  test runs:             5 (4 green, 1 red; 13 cases passed, 1 failed)\n  publishes blocked:     1\n  publishes delivered:   8 deliveries (4 versions to 2 targets), rollbacks: 1\n  receipts:              5 webhook (signed), 5 Jira comments, 5 Jira attachments\n  states:                set 1=published (live v2), set 2=published (live v1), set 3=published (live v2)";
