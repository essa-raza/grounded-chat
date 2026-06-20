type GuardrailLogEntry = {
  timestamp: string;
  invalidIds: string[];
  invalidUrls: string[];
  message: string;
};

export function logGuardrailEvent(entry: GuardrailLogEntry) {
  console.warn("[guardrail]", JSON.stringify(entry));
}
