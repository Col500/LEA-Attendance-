import React from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Compass,
  RotateCcw,
  Sparkles,
  X
} from 'lucide-react';
import {
  TUTORIAL_STEPS,
  TutorialEvaluation,
  TutorialGuideState,
  TutorialStepDefinition
} from '../services/tutorialGuide';

interface OnboardingGuideProps {
  guideState: TutorialGuideState;
  evaluation: TutorialEvaluation;
  onExecuteStep: (step: TutorialStepDefinition, index: number) => void;
  onSelectStepIndex: (index: number) => void;
  onToggleCollapse: () => void;
  onDismiss: () => void;
  onRestart: () => void;
}

export const OnboardingGuide: React.FC<OnboardingGuideProps> = ({
  guideState,
  evaluation,
  onExecuteStep,
  onSelectStepIndex,
  onToggleCollapse,
  onDismiss,
  onRestart
}) => {
  if (guideState.dismissed) {
    return null;
  }

  if (evaluation.allCompleted && guideState.completedBannerDismissed) {
    return null;
  }

  const currentIdx = Math.max(
    0,
    Math.min(TUTORIAL_STEPS.length - 1, guideState.activeStepIndex)
  );
  const currentStepStatus = evaluation.steps[currentIdx];
  const currentStep = currentStepStatus.definition;
  const progressPct = Math.round(
    (evaluation.completedCount / evaluation.totalSteps) * 100
  );

  if (guideState.collapsed) {
    return (
      <div className="mb-5 bg-white rounded-lg border border-emerald-200 px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 rounded-md bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
            <Compass className="w-4 h-4" />
          </div>
          <div className="min-w-0 text-xs">
            <span className="font-bold text-slate-900">
              Setup Guide · Step {currentStep.stepNumber} of {evaluation.totalSteps}:
            </span>{' '}
            <span className="text-slate-600">{currentStep.shortTitle}</span>
            <span className="text-emerald-700 font-semibold ml-2 tabular-nums">
              ({evaluation.completedCount}/{evaluation.totalSteps} done)
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onExecuteStep(currentStep, currentIdx)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
          >
            <span>{currentStep.actionLabel}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
            title="Expand setup guide"
            aria-label="Expand setup guide"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
            title="Dismiss guide"
            aria-label="Dismiss setup guide"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <section
      aria-label="Interactive Setup Tutorial"
      className="mb-6 bg-white rounded-xl border border-emerald-200/90 shadow-xs overflow-hidden"
    >
      {/* Top progress strip */}
      <div className="px-4 sm:px-5 py-3 bg-emerald-50/70 border-b border-emerald-100 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-emerald-700 text-white flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-900">
              {evaluation.allCompleted
                ? 'Setup Walkthrough Complete'
                : 'Guided App Walkthrough'}
            </div>
            <div className="text-[11px] text-slate-600 tabular-nums">
              {evaluation.completedCount} of {evaluation.totalSteps} steps completed ({progressPct}%)
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {evaluation.allCompleted && (
            <button
              type="button"
              onClick={onRestart}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Restart Tour</span>
            </button>
          )}
          <button
            type="button"
            onClick={onToggleCollapse}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-600 cursor-pointer"
            title="Minimize guide"
          >
            <ChevronUp className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Minimize</span>
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-white cursor-pointer"
            title="Hide setup guide (reopen anytime in Settings)"
            aria-label="Hide setup guide"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Interactive 4-step selector bar */}
      <div className="px-4 sm:px-5 pt-3.5 pb-2 grid grid-cols-2 lg:grid-cols-4 gap-2">
        {evaluation.steps.map((item, idx) => {
          const isCurrent = idx === currentIdx;
          return (
            <button
              key={item.definition.id}
              type="button"
              onClick={() => onSelectStepIndex(idx)}
              className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                isCurrent
                  ? 'border-emerald-600 bg-emerald-50/70'
                  : item.completed
                  ? 'border-emerald-200 bg-white hover:bg-emerald-50/30'
                  : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50'
              }`}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 tabular-nums ${
                  item.completed
                    ? 'bg-emerald-600 text-white'
                    : isCurrent
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-200 text-slate-600'
                }`}
              >
                {item.completed ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  item.definition.stepNumber
                )}
              </div>
              <div className="min-w-0">
                <div
                  className={`text-xs font-semibold truncate ${
                    isCurrent ? 'text-slate-900' : 'text-slate-700'
                  }`}
                >
                  {item.definition.shortTitle}
                </div>
                <div className="text-[10px] text-slate-500">
                  {item.completed ? 'Completed' : isCurrent ? 'Current step' : 'Pending'}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Active Step Instruction & Live Operate CTA */}
      <div className="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-slate-100 mt-2">
        <div className="space-y-1 max-w-2xl">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
              Step {currentStep.stepNumber} of {evaluation.totalSteps}
            </span>
            {currentStepStatus.completed && (
              <span className="text-[11px] font-semibold text-emerald-700">
                · Done
              </span>
            )}
          </div>
          <h3 className="text-sm sm:text-base font-bold text-slate-900">
            {currentStep.title}
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            {currentStep.description}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {currentIdx < evaluation.totalSteps - 1 && (
            <button
              type="button"
              onClick={() => {
                const nextIdx = currentIdx + 1;
                onSelectStepIndex(nextIdx);
              }}
              className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
            >
              {currentStepStatus.completed ? 'Next Step →' : 'Skip for Now'}
            </button>
          )}

          {evaluation.allCompleted && currentIdx === evaluation.totalSteps - 1 ? (
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold shadow-xs cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Finish Guide</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onExecuteStep(currentStep, currentIdx)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold shadow-xs cursor-pointer"
            >
              <span>{currentStep.actionLabel}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
