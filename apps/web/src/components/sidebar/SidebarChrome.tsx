import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { T, useGT } from "gt-react";
import { memo } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";

import { useAtomValue } from "@effect/atom-react";
import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { shortcutLabelForCommand } from "../../keybindings";
import {
  navigateHistory,
  useCanNavigateHistory,
  type HistoryDirection,
} from "../../navigationHistory";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { cn } from "../../lib/utils";
import { useIssuesSupported, usePullRequestsSupported } from "../../state/environments";
import {
  resolveEnvironmentIdentificationPillLabel,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import fanggeHalfUrl from "../../assets/vibeboss-fangge-half.webp";
import { useMascotLift, useMascotSide } from "../../vibebossAppearance";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { readIssueListPreferences } from "../issue/issueListPreferences";
import { isSidebarUtilityPage, useNavigateToMainApp } from "./mainAppLocation";
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { VIBEBOSS_SIDEBAR_APP_UPDATES_ONLY } from "../../vibeboss";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { observeResize } from "~/lib/observeResize";
import { AnimateIcon } from "@animate-ui/react/icons";
import { BlocksIcon } from "../animate-ui/icons/blocks";
import { BotIcon } from "../animate-ui/icons/bot";
import { CalendarClockIcon } from "../animate-ui/icons/calendar-clock";
import { ChartNoAxesColumnIcon } from "../animate-ui/icons/chart-no-axes-column";
import { CircleAlertIcon } from "../animate-ui/icons/circle-alert";
import { LibraryIcon } from "../animate-ui/icons/library";
import { RouteIcon } from "../animate-ui/icons/route";
import { SettingsIcon } from "../animate-ui/icons/settings";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const gt = useGT();
  const [mascotSide] = useMascotSide();
  const [mascotLift] = useMascotLift();
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;

  return (
    <div
      className={cn(
        "relative flex h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center gap-2 pr-3",
        isElectron && "drag-region",
      )}
    >
      {/* VibeBoss: the mascot band replaces T3's environment stage backdrop. */}
      <div
        aria-hidden="true"
        className="sidebar-stage-backdrop pointer-events-none absolute inset-x-0 top-0 z-0 h-20 select-none overflow-hidden bg-linear-to-r from-brand-band via-brand-band-soft to-transparent"
      >
        <img
          src={fanggeHalfUrl}
          alt=""
          draggable={false}
          className={cn(
            "absolute h-20 w-auto",
            // Over the title the mascot stays faint so the name remains readable.
            mascotSide === "right" ? "right-2 opacity-90" : "left-0 opacity-40",
          )}
          style={{ top: -mascotLift }}
        />
      </div>
      <div className="relative top-[calc(var(--workspace-controls-top)-env(safe-area-inset-top))] z-10 ml-[calc(var(--workspace-controls-left)+1px-env(safe-area-inset-left))] flex shrink-0 items-center md:hidden">
        <SidebarTrigger
          variant="ghost"
          className="relative top-auto translate-y-0"
          aria-label={gt("Toggle main sidebar")}
        />
      </div>
      {/* No z-index here: the title must share a stacking context with the mascot to blend with it. */}
      <div className="relative flex h-8 min-w-0 flex-1 flex-wrap content-start items-center gap-x-2 overflow-hidden py-0.5">
        <div className="flex shrink-0 items-center gap-1">
          <SidebarBrand onBackdrop={false} />
          {isElectron ? (
            <div className="hidden items-center md:flex">
              <HistoryNavigationButton direction="back" onBackdrop={false} />
              <HistoryNavigationButton direction="forward" onBackdrop={false} />
            </div>
          ) : null}
        </div>
        {pillLabel ? (
          <div className="ml-1 flex h-7 items-center">
            <Badge data-environment-identification="pill" size="sm" variant="secondary">
              {pillLabel}
            </Badge>
          </div>
        ) : null}
      </div>
    </div>
  );
});

export function SidebarBrandWidthProbe({
  isElectron,
  onWidthChange,
}: {
  isElectron: boolean;
  onWidthChange: (width: number) => void;
}) {
  const observeWidth = (probe: HTMLDivElement) => {
    return observeResize(probe, ([entry]) => {
      if (entry) onWidthChange(entry.borderBoxSize[0]?.inlineSize ?? probe.offsetWidth);
    });
  };

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none invisible fixed top-0 left-0 flex w-max border-r border-transparent pr-3"
      ref={observeWidth}
    >
      <div className="ml-[var(--workspace-titlebar-content-left)] flex gap-1">
        <SidebarBrandMark onBackdrop={false} />
        {isElectron ? <div className="w-[calc(2*var(--workspace-titlebar-control-size))]" /> : null}
      </div>
    </div>
  );
}

function HistoryNavigationButton({
  direction,
  onBackdrop,
}: {
  direction: HistoryDirection;
  onBackdrop: boolean;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const enabled = useCanNavigateHistory(direction);
  const gt = useGT();
  const label = direction === "back" ? gt("Go back") : gt("Go forward");
  const shortcutLabel = shortcutLabelForCommand(
    keybindings,
    direction === "back" ? "navigation.back" : "navigation.forward",
  );
  const Icon = direction === "back" ? ArrowLeftIcon : ArrowRightIcon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className={cn(
              "[-webkit-app-region:no-drag]",
              onBackdrop && "relative top-auto translate-y-0",
            )}
            disabled={!enabled}
            onClick={() => navigateHistory(direction)}
            size="icon-sm"
            variant={onBackdrop ? "media-navigation" : "ghost"}
          />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {label}
        {shortcutLabel ? ` (${shortcutLabel})` : ""}
      </TooltipPopup>
    </Tooltip>
  );
}

function SidebarBrand({ onBackdrop }: { onBackdrop: boolean }) {
  const gt = useGT();
  return (
    <Link
      aria-label={gt("VibeBoss home")}
      className={cn(
        "relative ml-[var(--workspace-titlebar-content-left)] hidden h-7 w-fit min-w-0 shrink-0 items-center overflow-hidden rounded-md outline-hidden ring-ring focus-visible:ring-2 focus-visible:ring-inset md:flex",
        onBackdrop ? "text-white" : "text-foreground",
      )}
      to="/"
    >
      <SidebarBrandMark onBackdrop={onBackdrop} />
    </Link>
  );
}

function SidebarBrandMark({ onBackdrop: _onBackdrop }: { onBackdrop: boolean }) {
  return (
    // White under "difference" blending inverts whatever is behind it, pixel by pixel:
    // dark over the light band, light over the mascot's sunglasses or a dark theme.
    <span className="truncate font-semibold text-sm tracking-tight text-white mix-blend-difference">
      {"VibeBoss"}
    </span>
  );
}

function SidebarUtilityItem({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <AnimateIcon animateOnHover asChild>
      <SidebarMenuItem className="shrink-0">
        <Tooltip>
          <TooltipTrigger
            render={
              <SidebarMenuButton aria-label={label} onClick={onClick} size="icon">
                {icon}
              </SidebarMenuButton>
            }
          />
          <TooltipPopup side="top">{label}</TooltipPopup>
        </Tooltip>
      </SidebarMenuItem>
    </AnimateIcon>
  );
}

type VibeBossNavTarget =
  | "/settings/scheduled-tasks"
  | "/usage"
  | "/agents"
  | "/capabilities"
  | "/knowledge";

/** VibeBoss destinations as labelled rows under the search box, like a desktop app's nav. */
export const SidebarVibeBossNav = memo(function SidebarVibeBossNav() {
  const navigate = useNavigate();
  const gt = useGT();
  const { isMobile, setOpenMobile } = useSidebar();
  const pathname = useLocation({ select: (location) => location.pathname });
  const items: ReadonlyArray<{ to: VibeBossNavTarget; label: string; icon: ReactNode }> = [
    { to: "/settings/scheduled-tasks", label: gt("Scheduled tasks"), icon: <CalendarClockIcon /> },
    { to: "/agents", label: gt("Roles & rules"), icon: <BotIcon /> },
    { to: "/capabilities", label: gt("Skills, MCP & plugins"), icon: <BlocksIcon /> },
    { to: "/knowledge", label: gt("Knowledge"), icon: <LibraryIcon /> },
  ];
  return (
    <SidebarMenu className="mt-1">
      {items.map(({ to, label, icon }) => (
        <AnimateIcon key={to} animateOnHover asChild>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname === to || (to === "/agents" && pathname === "/rules")}
              onClick={() => {
                if (isMobile) setOpenMobile(false);
                void navigate({ to });
              }}
            >
              {icon}
              <span>{label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </AnimateIcon>
      ))}
    </SidebarMenu>
  );
});

const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const gt = useGT();
  const { isMobile, setOpenMobile } = useSidebar();
  const isOnUtilityPage = useLocation({
    select: (location) => isSidebarUtilityPage(location.pathname),
  });
  const pullRequestsSupported = usePullRequestsSupported();
  const issuesSupported = useIssuesSupported();
  const closeMobileSidebar = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };
  const handlePullRequestsClick = () => {
    closeMobileSidebar();
    void navigate({
      to: "/pull-requests",
      search: readPullRequestListPreferences(),
    });
  };
  const handleIssuesClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/issues", search: readIssueListPreferences() });
  };
  const handleSettingsClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  };

  const handleBackClick = () => {
    closeMobileSidebar();
    void navigateToMainApp();
  };

  return (
    <SidebarMenu className="flex-row items-center">
      {isOnUtilityPage ? (
        <SidebarMenuItem className="min-w-0 flex-1">
          <SidebarMenuButton onClick={handleBackClick}>
            <ArrowLeftIcon />
            <span>
              <T>Back</T>
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : (
        <>
          <SidebarUtilityItem
            icon={<SettingsIcon />}
            label={gt("Settings")}
            onClick={handleSettingsClick}
          />
          {pullRequestsSupported ? (
            <SidebarUtilityItem
              icon={<RouteIcon />}
              label={gt("Pull requests")}
              onClick={handlePullRequestsClick}
            />
          ) : null}
          {issuesSupported ? (
            <SidebarUtilityItem
              icon={<CircleAlertIcon />}
              label={gt("Issues", { $context: "sidebar link to the list of issues" })}
              onClick={handleIssuesClick}
            />
          ) : null}
          <SidebarUtilityItem
            icon={<ChartNoAxesColumnIcon />}
            label={gt("Usage")}
            onClick={() => {
              closeMobileSidebar();
              void navigate({ to: "/usage" });
            }}
          />
        </>
      )}
      <SidebarThreadUndoNotice />
      <SidebarUpdatePill />
    </SidebarMenu>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  return (
    <SidebarFooter>
      {VIBEBOSS_SIDEBAR_APP_UPDATES_ONLY ? null : <SidebarProviderUpdatePill />}
      <SidebarUpdateArchitectureWarning />
      <SidebarUtilityMenu />
    </SidebarFooter>
  );
});
