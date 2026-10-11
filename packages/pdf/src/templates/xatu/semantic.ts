import type { TemplateSemanticManifest } from "../../semantic/template-manifest";
import { baseManifest, itemHeaderRowPart } from "../../semantic/shared-parts";

export const xatuSemanticManifest = baseManifest("xatu", [itemHeaderRowPart]) satisfies TemplateSemanticManifest;
