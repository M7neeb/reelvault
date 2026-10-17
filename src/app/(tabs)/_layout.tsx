/**
 * The tab group. Lives here rather than at the root so that non-tab routes
 * (such as `/preview`) can sit beside it - see the note in `../_layout.tsx`.
 * The data layers are mounted once, above the tabs, and shared by all of them.
 */
import AppTabs from '@/components/app-tabs';
import { HomeDataProvider } from '@/features/home/HomeData';

export default function TabsLayout() {
  return (
    <HomeDataProvider>
      <AppTabs />
    </HomeDataProvider>
  );
}
