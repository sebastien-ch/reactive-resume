import type { TemplateSemanticManifest } from "../../semantic/template-manifest";
import { baseManifest, itemHeaderRowPart } from "../../semantic/shared-parts";

export const xatuduoSemanticManifest = baseManifest("xatuduo", [itemHeaderRowPart]) satisfies TemplateSemanticManifest;
