import { type CalendarSearch, CalendarView } from "@/components/calendar-view";

export const metadata = { title: "Calendar" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<CalendarSearch> }) {
  return <CalendarView sp={await searchParams} base="/calendar" title="Calendar" crumbs={[{ label: "Today", href: "/today" }, { label: "Calendar" }]} />;
}
