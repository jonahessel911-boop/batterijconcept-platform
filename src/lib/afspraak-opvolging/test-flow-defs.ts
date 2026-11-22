export type TestFlowId = "intensief" | "rustig";

export type TestFlowStepId =
  | "bevestiging"
  | "social-proof"
  | "reminder-48u"
  | "avond-vooraf";

export type TestFlowStepDef = {
  id: TestFlowStepId;
  label: string;
  hasMail: boolean;
  hasSms: boolean;
};

export const TEST_FLOW_STEPS: Record<TestFlowId, TestFlowStepDef[]> = {
  intensief: [
    {
      id: "bevestiging",
      label: "Bevestiging",
      hasMail: true,
      hasSms: true,
    },
    {
      id: "social-proof",
      label: "Social proof",
      hasMail: true,
      hasSms: false,
    },
    {
      id: "reminder-48u",
      label: "Reminder 48u",
      hasMail: true,
      hasSms: true,
    },
    {
      id: "avond-vooraf",
      label: "Avond vooraf",
      hasMail: true,
      hasSms: true,
    },
  ],
  rustig: [
    {
      id: "bevestiging",
      label: "Bevestiging",
      hasMail: true,
      hasSms: true,
    },
    {
      id: "avond-vooraf",
      label: "Avond vooraf",
      hasMail: false,
      hasSms: true,
    },
  ],
};
