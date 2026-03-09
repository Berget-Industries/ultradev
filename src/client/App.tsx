import { Routes, Route } from 'react-router-dom'
import { Shell } from './components/layout/Shell'
import DashboardPage from './pages/DashboardPage'
import CronjobsPage from './pages/CronjobsPage'
import UsagePage from './pages/UsagePage'
import SettingsPage from './pages/SettingsPage'
import UpdatePage from './pages/UpdatePage'

export default function App() {
  return (
    <Routes>
      <Route path="/updating" element={<UpdatePage />} />
      <Route
        path="*"
        element={
          <Shell>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/crons" element={<CronjobsPage />} />
              <Route path="/usage" element={<UsagePage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </Shell>
        }
      />
    </Routes>
  )
}
