import { GoogleGenAI, Type } from "@google/genai";
import type { AgentDecision, ReasoningModel } from "../reasoning-model.js";
import type { CaseContext } from "../../model/context-builder.js";

export class GeminiReasoningModel implements ReasoningModel {
  private ai: GoogleGenAI;
  private modelName: string;

  constructor(apiKey: string, modelName: string = "gemini-2.5-flash") {
    this.ai = new GoogleGenAI({ apiKey });
    this.modelName = modelName;
  }

  async reason(context: CaseContext): Promise<AgentDecision> {
    const prompt = `
You are an operational AI agent analyzing a business case.
Analyze the following case context and decide what action to take.

Case Context:
${JSON.stringify(context, null, 2)}

Based on the rules of the system:
- If inventory is critically low and a supplier is available, propose a CREATE_PURCHASE_ORDER action to restore stock above minimum levels.
- If there is not enough information or you are unsure, ESCALATE.
- Otherwise, NO_ACTION.
`;

    const response = await this.ai.models.generateContent({
      model: this.modelName,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            decision: {
              type: Type.STRING,
              enum: ["NO_ACTION", "PROPOSE_ACTION", "ESCALATE"],
            },
            rationale: {
              type: Type.STRING,
            },
            action: {
              type: Type.OBJECT,
              nullable: true,
              properties: {
                type: {
                  type: Type.STRING,
                  enum: ["CREATE_PURCHASE_ORDER"],
                },
                productId: {
                  type: Type.STRING,
                },
                supplierId: {
                  type: Type.STRING,
                  nullable: true,
                },
                quantity: {
                  type: Type.INTEGER,
                },
              },
              required: ["type", "productId", "quantity"],
            },
            confidence: {
              type: Type.NUMBER,
            },
          },
          required: ["decision", "rationale"],
        },
      },
    });

    if (!response.text) {
        throw new Error("No response text from Gemini");
    }

    const decision: AgentDecision = JSON.parse(response.text);
    return decision;
  }
}
