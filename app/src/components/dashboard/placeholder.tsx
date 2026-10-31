import type { ReactNode } from "react";
import { DashHeader, Empty, Panel } from "./ui";

/** A workspace section whose screens are added in a later build phase (server-safe). */
export function SectionPlaceholder({ title, description, icon, heading, text }: { title: string; description: string; icon: ReactNode; heading: string; text: string }) {
  return (
    <>
      <DashHeader title={title} description={description} />
      <Panel>
        <Empty icon={icon} title={heading}>
          {text}
        </Empty>
      </Panel>
    </>
  );
}
