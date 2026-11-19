import { type CalendarSearch, CalendarView } from "@/components/calendar-view";

export const metadata = { title: "Timetable" };

export default async function TimetablePage({ searchParams }: { searchParams: Promise<CalendarSearch> }) {
  return (
    <CalendarView
      sp={await searchParams}
      base="/academics/timetable"
      title="Timetable"
      crumbs={[{ label: "Today", href: "/today" }, { label: "Academics", href: "/academics" }, { label: "Timetable" }]}
    />
  );
}
