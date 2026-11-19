// api/chat.js

const MODEL = "deepseek-v4-1-flash-1017-uncensored";

// Edit the text between the backticks to set the chatbot's instructions.
// This stays on the server, but do not put secrets in the prompt.
const MASTER_PROMPT = `
You are a helpful conversational assistant.
Answer clearly, accurately, and directly.
If you are unsure, say so instead of making up information.
`.trim();

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Only POST requests are allowed."
    });
  }

  const apiKey = process.env.VENICE_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "VENICE_API_KEY is not configured in Vercel."
    });
  }

  let body;

  try {
    body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;
  } catch {
    return res.status(400).json({
      error: "Invalid JSON request."
    });
  }

  const messages = body?.messages;

  // Only accept user and assistant messages from the browser.
  // The master prompt is added separately on the server.
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > 100 ||
    !messages.every(
      (message) =>
        message &&
        ["user", "assistant"].includes(message.role) &&
        typeof message.content === "string" &&
        message.content.trim().length > 0
    )
  ) {
    return res.status(400).json({
      error: "Send between 1 and 100 valid chat messages."
    });
  }

  if (JSON.stringify(messages).length > 100000) {
    return res.status(413).json({
      error: "Conversation is too long. Refresh to start a new chat."
    });
  }

  try {
    const response = await fetch(
      "https://api.venice.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            {
              role: "system",
              content: MASTER_PROMPT
            },
            ...messages.map(({ role, content }) => ({
              role,
              content
            }))
          ],
          stream: false
        }),
        signal: AbortSignal.timeout(25000)
      }
    );

    if (!response.ok) {
      const errorMessages = {
        400: "Venice rejected the request. Check the model ID and request settings.",
        401: "Venice rejected the API key. Check VENICE_API_KEY.",
        402: "Check your Venice account balance or billing.",
        403: "Your Venice account or API key cannot access this request.",
        404: "Venice could not find the requested model or endpoint.",
        429: "Venice is rate-limiting requests. Please try again shortly."
      };

      return res.status(502).json({
        error:
          errorMessages[response.status] ||
          `Venice request failed (${response.status}).`
      });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content;

    if (typeof reply !== "string" || !reply.trim()) {
      return res.status(502).json({
        error: "Venice returned an empty or invalid reply."
      });
    }

    return res.status(200).json({ reply });
  } catch (error) {
    const timedOut =
      error.name === "TimeoutError" ||
      error.name === "AbortError";

    return res.status(timedOut ? 504 : 502).json({
      error: timedOut
        ? "Venice took too long to respond. Please try again."
        : "Unable to connect to Venice. Please try again."
    });
  }
};
