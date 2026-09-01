// "How do I get an API key?" - a small link that opens a modal with
// per-provider, step-by-step instructions written for total beginners.

import { useState } from "react";

const PROVIDERS = [
  {
    name: "Claude (Anthropic)",
    url: "https://console.anthropic.com/settings/keys",
    urlLabel: "console.anthropic.com",
    keyLooks: "sk-ant-...",
    steps: [
      "Create an account (or sign in) and add a small credit balance.",
      "Open Settings → API keys.",
      "Click \"Create key\", give it any name, and copy it.",
    ],
  },
  {
    name: "OpenAI",
    url: "https://platform.openai.com/api-keys",
    urlLabel: "platform.openai.com/api-keys",
    keyLooks: "sk-...",
    steps: [
      "Create an account (or sign in) and add billing credit.",
      "Open the API keys page.",
      "Click \"Create new secret key\" and copy it.",
    ],
  },
  {
    name: "Gemini (Google)",
    url: "https://aistudio.google.com/apikey",
    urlLabel: "aistudio.google.com/apikey",
    keyLooks: "AIza...",
    steps: [
      "Sign in with any Google account.",
      "Click \"Create API key\".",
      "Copy the key. Gemini has a free tier, so this one can cost nothing.",
    ],
  },
  {
    name: "OpenRouter",
    url: "https://openrouter.ai/keys",
    urlLabel: "openrouter.ai/keys",
    keyLooks: "sk-or-...",
    steps: [
      "Create an account and add a few dollars of credit.",
      "Open Keys and click \"Create key\".",
      "Copy it. One OpenRouter key unlocks many models (Qwen, DeepSeek, Llama...).",
    ],
  },
];

export default function ApiKeyHelp({ linkText = "How do I get an API key?" }: {
  linkText?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <a href="#" onClick={(e) => { e.preventDefault(); setOpen(true); }}>
        {linkText}
      </a>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal glass" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Getting an API key</h3>
              <button type="button" className="secondary modal-close"
                      onClick={() => setOpen(false)}>✕</button>
            </div>
            <p className="hint">
              An API key is like a prepaid card for an AI model. You create it on the
              AI company's website, paste it here, and your agent uses that model to
              think. It takes about 2 minutes. Pick any one provider:
            </p>
            {PROVIDERS.map((p) => (
              <div className="card subtle" key={p.name}>
                <strong>{p.name}</strong>{" "}
                <a href={p.url} target="_blank" rel="noreferrer">{p.urlLabel} ↗</a>
                <ol className="hint keyhelp-steps">
                  {p.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
                <p className="hint">The key looks like <code>{p.keyLooks}</code></p>
              </div>
            ))}
            <p className="hint">
              Your key is stored encrypted and never shown again. You set spending
              caps here, and you can delete the key on the provider's site any time.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
