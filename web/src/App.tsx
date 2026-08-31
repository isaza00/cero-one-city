import type { ReactElement } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { useAuth } from "./store/auth";
import Admin from "./routes/Admin";
import AgentPanel from "./routes/AgentPanel";
import AgentsList from "./routes/AgentsList";
import { Login, Register } from "./routes/Auth";
import ConnectModel from "./routes/ConnectModel";
import CreateAgent from "./routes/CreateAgent";
import CustomMatch from "./routes/CustomMatch";
import Landing from "./routes/Landing";
import Leaderboard from "./routes/Leaderboard";
import LiveMatch from "./routes/LiveMatch";
import MatchesList from "./routes/MatchesList";
import Onboarding from "./routes/Onboarding";
import PostMatch from "./routes/PostMatch";
import Profile from "./routes/Profile";
import Replay from "./routes/Replay";
import SettingsPage from "./routes/SettingsPage";
import RemoteSetup from "./routes/RemoteSetup";

function Private({ children }: { children: ReactElement }) {
  const user = useAuth((s) => s.user);
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/matches" element={<MatchesList />} />
          <Route path="/matches/:matchId" element={<LiveMatch />} />
          <Route path="/matches/:matchId/replay" element={<Replay />} />
          <Route path="/matches/:matchId/result" element={<PostMatch />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/profile/:agentId" element={<Profile />} />
          <Route path="/onboarding" element={<Private><Onboarding /></Private>} />
          <Route path="/agents" element={<Private><AgentsList /></Private>} />
          <Route path="/agents/new" element={<Private><CreateAgent /></Private>} />
          <Route path="/agents/:agentId" element={<Private><AgentPanel /></Private>} />
          <Route path="/agents/:agentId/connect" element={<Private><ConnectModel /></Private>} />
          <Route path="/agents/:agentId/remote-setup" element={<Private><RemoteSetup /></Private>} />
          <Route path="/custom" element={<Private><CustomMatch /></Private>} />
          <Route path="/settings" element={<Private><SettingsPage /></Private>} />
          <Route path="/admin" element={<Private><Admin /></Private>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
