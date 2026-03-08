import { Routes, Route } from 'react-router-dom'
import { Shell } from './components/layout/Shell'
import DashboardPage from './pages/DashboardPage'
import ProjectsPage from './pages/ProjectsPage'
import CronjobsPage from './pages/CronjobsPage'
import UsagePage from './pages/UsagePage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/crons" element={<CronjobsPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Shell>
  )
}
