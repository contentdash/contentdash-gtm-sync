/*
  Airtable Automation: "Charlene Inbound Lead -> Pipeline Ops"

  Use in Automations > Run a script, not in a Scripting Extension.

  Expected automation inputs:
  - webhookUrl            (text)   e.g. deployed Apps Script web app URL with ?token=...
  - sourceRecordId        (record id from trigger)
  - sourceRecordUrl       (optional Airtable record URL)
  - createdTime           (trigger field / created time)
  - company               (company / brand / organization field)
  - contactName           (primary contact full name)
  - contactRole           (job title / role)
  - companyUrl            (website)
  - notes                 (free text notes / message)
  - skuInterest           (package / service / product field)
  - leadSource            (optional, defaults to "Airtable site form")
*/

const inputConfig = input.config();

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeSku(value) {
  const raw = clean(value).toLowerCase();
  if (!raw) return "Unsure";

  const mappings = [
    ["Unlimited Copies", ["copy", "copies", "unlimited copies", "text"]],
    ["Unlimited Graphics", ["graphics", "design", "creative", "unlimited graphics"]],
    ["Unlimited Content", ["content", "unlimited content"]],
    ["Social Media Growth Pack", ["social", "growth pack", "social media"]],
    ["BOSS", ["boss"]],
    ["Performance & Search", ["seo", "search", "performance"]],
    ["Brand Rules + QA Layer", ["brand rules", "qa layer", "quality assurance"]],
    ["Video Repurposing", ["video", "repurposing"]],
    ["Consultation", ["consultation", "consult", "strategy call"]],
  ];

  for (const [sku, keywords] of mappings) {
    if (keywords.some((keyword) => raw.includes(keyword))) return sku;
  }

  return "Unsure";
}

const payload = {
  sourceSystem: "Airtable",
  sourceRecordId: clean(inputConfig.sourceRecordId),
  sourceRecordUrl: clean(inputConfig.sourceRecordUrl),
  createdTime: clean(inputConfig.createdTime),
  account: clean(inputConfig.company),
  primaryContact: clean(inputConfig.contactName),
  primaryContactRole: clean(inputConfig.contactRole),
  companyUrl: clean(inputConfig.companyUrl),
  leadSource: clean(inputConfig.leadSource) || "Airtable site form",
  notes: clean(inputConfig.notes),
  likelySku: normalizeSku(inputConfig.skuInterest),
  defaults: {
    owner: "Charlene",
    stage: "ICP Fit",
    replyStatus: "Wants Info",
    qualificationBooked: "N",
    discoveryBooked: "N",
    founderNeeded: "N",
    lastActivityType: "Form Submission",
    nextStep: "Review new inbound lead",
  },
};

if (!payload.sourceRecordId) {
  throw new Error("Missing sourceRecordId.");
}

if (!payload.account) {
  throw new Error("Missing company/account field. Do not sync unnamed leads.");
}

const response = await fetch(inputConfig.webhookUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const text = await response.text();
let result;

try {
  result = JSON.parse(text);
} catch (_error) {
  throw new Error(`Webhook returned non-JSON response: ${text}`);
}

if (!response.ok || !result.ok) {
  throw new Error(result.error || `Webhook failed with status ${response.status}`);
}

output.set("syncStatus", result.action === "inserted" ? "Synced - inserted" : "Synced - updated");
output.set("syncRowNumber", String(result.rowNumber || ""));
output.set("syncAction", result.action || "");
output.set("syncTimestamp", result.syncedAt || new Date().toISOString());
