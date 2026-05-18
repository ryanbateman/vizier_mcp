import { z } from "zod";

export const blockRequestSchema = {
  minX: z.number().describe("Minimum X coordinate"),
  minY: z.number().describe("Minimum Y coordinate"),
  minZ: z.number().describe("Minimum Z (depth) coordinate"),
  maxX: z.number().describe("Maximum X coordinate"),
  maxY: z.number().describe("Maximum Y coordinate"),
  maxZ: z.number().describe("Maximum Z (depth) coordinate"),
};
