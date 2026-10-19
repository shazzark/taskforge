const SUPPORTED_INPUT_SUFFIX = /\.(?:csv|txt|md|markdown|pdf|docx|xlsx)(?=$|[\s"'`),;.!?])/iu;
const FILE_ANALYSIS_INTENT = /\b(?:analy[sz]e|inspect|count|calculate|compute|total|sum|summari[sz]e|report|extract|check)\b/iu;
const MISSING_INPUT_QUESTION = /\b(?:which|what)\s+(?:file|path|column|format|sheet)\b|\b(?:need|missing)\s+(?:the\s+)?(?:file|path|column|format|sheet)\b/iu;
const FILE_APPROVAL_REQUEST = /\b(?:approval|permission|consent|authorize|authorise|grant|approve)\b/iu;
const FILE_ACCESS_REFERENCE = /\b(?:file|read|access)\b/iu;

/** Require a model-selected host tool when the user named a supported file and an analysis action. */
export function shouldRequireAnalysisTool(instruction: string): boolean {
  return SUPPORTED_INPUT_SUFFIX.test(instruction) &&
    FILE_ANALYSIS_INTENT.test(instruction) &&
    !MISSING_INPUT_QUESTION.test(instruction);
}

/** A clarification or permission request is not completion of a one-shot action. */
export function isIncompleteActionResponse(content: string): boolean {
  const asksForFileApproval = FILE_APPROVAL_REQUEST.test(content) && FILE_ACCESS_REFERENCE.test(content);
  const asksForClarification = MISSING_INPUT_QUESTION.test(content) ||
    /\b(?:please provide|please clarify|could you provide|could you clarify)\b.{0,120}\b(?:file|path|column|format|sheet|details)\b/iu.test(content);
  return asksForFileApproval || asksForClarification;
}

export function isIncompleteOneShotResult(content: string, toolActions: number, requiresAnalysisTool: boolean): boolean {
  return isIncompleteActionResponse(content) || (toolActions === 0 && requiresAnalysisTool);
}
