/**
 * The tab group. Lives here rather than at the root so that non-tab routes
 * (such as `/preview`) can sit beside it - see the note in `../_layout.tsx`.
 */
import AppTabs from '@/components/app-tabs';

export default function TabsLayout() {
  return <AppTabs />;
}
