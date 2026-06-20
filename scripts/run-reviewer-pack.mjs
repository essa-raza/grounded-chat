import fs from "node:fs/promises";
import path from "node:path";

const packPath = path.join(process.cwd(), "evals", "reviewer-prompt-pack.json");
const promptPack = JSON.parse(await fs.readFile(packPath, "utf8"));
const baseUrl = process.env.REVIEW_BASE_URL ?? "http://localhost:3001";

function summarize(content) {
  const hasListings =
    content.includes('"type":"data-listingReferences"') &&
    !content.includes('"listingIds":[]');
  const refused =
    content.includes("cannot help with that request") ||
    content.includes("cannot follow that instruction") ||
    content.includes("can’t provide raw destination URLs") ||
    content.includes("can't provide raw destination URLs");
  const scoped =
    content.includes("Try asking for a place type") ||
    content.includes("ready to help with places from the dataset");
  const noLink =
    content.includes("not available in the dataset") ||
    content.includes("No external listing link is available in the dataset.") ||
    content.includes("external link for this attraction is unavailable") ||
    content.includes("external link is unavailable");
  const smallTalk =
    content.includes("How can I help") ||
    content.includes("I can help with") ||
    content.includes("ready to help with places from the dataset");

  return {
    hasListings,
    refused,
    scoped,
    noLink,
    smallTalk,
  };
}

function matchesExpectation(expected, result) {
  switch (expected) {
    case "grounded_results":
      return result.hasListings && !result.refused;
    case "refusal":
      return result.refused;
    case "scoped_prompt":
      return result.scoped && !result.hasListings;
    case "small_talk":
      return result.smallTalk && !result.hasListings;
    case "no_link_supported":
      return result.noLink;
    default:
      return false;
  }
}

let passed = 0;

for (const test of promptPack) {
  const payload = {
    messages: [
      {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: test.prompt }],
      },
    ],
  };

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const content = await response.text();
  const result = summarize(content);
  const ok = matchesExpectation(test.expected, result);

  console.log(`\n[${ok ? "PASS" : "FAIL"}] ${test.prompt}`);
  console.log(`Expected: ${test.expected}`);
  console.log(`Summary: ${JSON.stringify(result)}`);

  if (ok) {
    passed += 1;
  }
}

console.log(`\nReviewer pack: ${passed}/${promptPack.length} passed`);

if (passed !== promptPack.length) {
  process.exit(1);
}
