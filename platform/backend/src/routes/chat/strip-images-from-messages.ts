/**
 * Strip base64 image data from messages before storing in database.
 *
 * After the LLM has processed images (e.g., screenshots from browser tools),
 * we don't need to keep the full base64 data in conversation history.
 * This prevents context limit issues on subsequent turns.
 *
 * The LLM has already analyzed the image - keeping it in history provides
 * no value and only burns tokens on future requests.
 */

const IMAGE_STRIPPED_PLACEHOLDER = "[Image data stripped to save context]";

/**
 * Check if a value looks like base64 image data
 * Base64 images are typically long strings (>1000 chars for any real image)
 */
function isBase64ImageData(value: unknown): boolean {
  if (typeof value !== "string") return false;
  // Base64 data URLs or raw base64 that's reasonably long
  if (value.startsWith("data:image/")) return true;
  // Raw base64 - check if it's long enough to be an image and looks like base64
  if (value.length > 1000 && /^[A-Za-z0-9+/=]+$/.test(value.slice(0, 100))) {
    return true;
  }
  return false;
}

/**
 * Recursively strip base64 image data from an object
 */
function stripImagesFromObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    return isBase64ImageData(obj) ? IMAGE_STRIPPED_PLACEHOLDER : obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => stripImagesFromObject(item));
  }

  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Known image data keys
      if (
        (key === "data" || key === "image_data") &&
        isBase64ImageData(value)
      ) {
        result[key] = IMAGE_STRIPPED_PLACEHOLDER;
      } else {
        result[key] = stripImagesFromObject(value);
      }
    }
    return result;
  }

  return obj;
}

/**
 * Convert image content blocks to text placeholders
 * This handles arrays that contain image blocks (e.g., in tool results)
 */
function convertImageBlocksToText(content: unknown): unknown {
  if (!Array.isArray(content)) {
    return stripImagesFromObject(content);
  }

  return content
    .map((item) => {
      if (typeof item !== "object" || item === null) return item;

      // Convert image blocks to text blocks
      if ("type" in item && item.type === "image") {
        return {
          type: "text",
          text: IMAGE_STRIPPED_PLACEHOLDER,
        };
      }

      // Recursively handle nested structures
      return stripImagesFromObject(item);
    })
    .filter((item) => item !== null);
}

/**
 * Strip base64 image data from a message's parts
 *
 * Handles:
 * - tool-result parts with nested image data (converts image blocks to text)
 * - image parts (converts to text parts)
 * - Any deeply nested base64 data in results
 */
// biome-ignore lint/suspicious/noExplicitAny: UIMessage structure from AI SDK is dynamic
function stripImagesFromParts(parts: any[]): any[] {
  return parts.map((part) => {
    // Handle tool-result parts - convert image blocks to text in result
    if (part.type === "tool-result" && part.result !== undefined) {
      return {
        ...part,
        result: convertImageBlocksToText(part.result),
      };
    }

    // Handle direct image parts - convert to text part entirely
    if (part.type === "image") {
      return {
        type: "text",
        text: IMAGE_STRIPPED_PLACEHOLDER,
      };
    }

    return part;
  });
}

/**
 * Strip base64 image data from messages before storing
 *
 * @param messages - Array of UIMessage objects from AI SDK
 * @returns Messages with base64 image data replaced by placeholders
 */
// biome-ignore lint/suspicious/noExplicitAny: UIMessage structure from AI SDK is dynamic
export function stripImagesFromMessages(messages: any[]): any[] {
  return messages.map((msg) => {
    if (!msg.parts || !Array.isArray(msg.parts)) {
      return msg;
    }

    return {
      ...msg,
      parts: stripImagesFromParts(msg.parts),
    };
  });
}

export const __test = {
  isBase64ImageData,
  stripImagesFromObject,
  IMAGE_STRIPPED_PLACEHOLDER,
};
