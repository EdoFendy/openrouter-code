import { z } from "zod";

export const SkillManifestSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  whenToUse: z.string().default(""),
  allowedTools: z.array(z.string()).default([]),
  disableModelInvocation: z.boolean().default(false),
  arguments: z.unknown().optional(),
  references: z.array(z.string()).default([]),
  scripts: z.array(z.string()).default([]),
  skillDir: z.string(),
  skillPath: z.string()
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

export type LoadedSkill = SkillManifest & {
  body: string;
};
