import React, { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  BookOpen,
  Box,
  Boxes,
  Clock3,
  Film,
  Gift,
  Layers3,
  PackageOpen,
  PanelsTopLeft,
  Play,
  Sparkles,
  WandSparkles,
  Workflow,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

type RecentProject = {
  name: string;
  currentStage: 'setup' | 'scene' | 'joy' | 'static' | 'post' | 'dynamic' | 'export';
  updatedAt: number;
  outputRatio: string;
} | null;

interface HomePageProps {
  recentProject: RecentProject;
  onOpenAtlas: () => void;
  onOpenSpecialty: () => void;
  onOpenPopup: () => void;
  onOpenJoy: () => void;
  onOpenFormats: () => void;
  onOpenLibrary: () => void;
}

const workflowSteps = [
  { number: '01', title: '场景分析', detail: '理解地点、氛围与构图目标' },
  { number: '02', title: '场景生成', detail: '生成并选择最合适的空间方案' },
  { number: '03', title: '角色植入', detail: '调整 JOY 动作、表情与画面位置' },
  { number: '04', title: '静态海报', detail: '融合角色、场景与视觉元素' },
  { number: '05', title: '海报后期', detail: '调整明暗、色彩与整体画面质感' },
  { number: '06', title: '动态海报', detail: '让最终画面拥有节奏与生命力' },
] as const;

const stageLabels: Record<NonNullable<RecentProject>['currentStage'], string> = {
  setup: '初始设置',
  scene: '场景生成',
  joy: '角色植入',
  static: '静态海报',
  post: '海报后期',
  dynamic: '动态海报',
  export: '导出',
};

const formatRelativeTime = (timestamp: number) => {
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
};

export function HomePage({
  recentProject,
  onOpenAtlas,
  onOpenSpecialty,
  onOpenPopup,
  onOpenJoy,
  onOpenFormats,
  onOpenLibrary,
}: HomePageProps) {
  const reduceMotion = useReducedMotion();
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    if (reduceMotion) return undefined;
    const timer = window.setInterval(() => {
      setActiveStep((current) => (current + 1) % workflowSteps.length);
    }, 2600);
    return () => window.clearInterval(timer);
  }, [reduceMotion]);

  const scrollToCapabilities = () => {
    document.getElementById('home-capabilities')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  return (
    <div className="joyflow-home scroll-area" onPointerLeave={() => setPointer({ x: 0, y: 0 })}>
      <section
        className="home-section home-hero"
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPointer({
            x: ((event.clientX - rect.left) / rect.width - 0.5) * 2,
            y: ((event.clientY - rect.top) / rect.height - 0.5) * 2,
          });
        }}
      >
        <div className="home-ambient home-ambient-one" />
        <div className="home-ambient home-ambient-two" />
        <div className="home-grid-field" />
        <div className="home-interactive-field" aria-hidden="true">
          <motion.div
            className="home-cursor-light"
            animate={{
              x: reduceMotion ? 0 : pointer.x * 120,
              y: reduceMotion ? 0 : pointer.y * 90,
            }}
            transition={{ type: 'spring', stiffness: 55, damping: 18, mass: 0.9 }}
          />
          <motion.div
            className="home-hero-ribbon ribbon-a"
            animate={{
              x: reduceMotion ? 0 : pointer.x * -32,
              y: reduceMotion ? 0 : pointer.y * -20,
              rotate: reduceMotion ? -14 : -14 + pointer.x * 2.5,
            }}
            transition={{ type: 'spring', stiffness: 38, damping: 18 }}
          />
          <motion.div
            className="home-hero-ribbon ribbon-b"
            animate={{
              x: reduceMotion ? 0 : pointer.x * 46,
              y: reduceMotion ? 0 : pointer.y * 34,
              rotate: reduceMotion ? 18 : 18 + pointer.y * 3,
            }}
            transition={{ type: 'spring', stiffness: 42, damping: 19 }}
          />
          <motion.div
            className="home-hero-ribbon ribbon-c"
            animate={{
              x: reduceMotion ? 0 : pointer.x * 68,
              y: reduceMotion ? 0 : pointer.y * -46,
            }}
            transition={{ type: 'spring', stiffness: 48, damping: 20 }}
          />
          <motion.div
            className="home-grid-lens"
            animate={{
              x: reduceMotion ? 0 : pointer.x * 18,
              y: reduceMotion ? 0 : pointer.y * 14,
              rotateX: reduceMotion ? 62 : 62 + pointer.y * 1.8,
              rotateZ: reduceMotion ? -8 : -8 + pointer.x * 1.4,
            }}
            transition={{ type: 'spring', stiffness: 45, damping: 18 }}
          />
          <div className="home-particle-cloud">
            {[
              [8, 22], [16, 64], [22, 38], [30, 80], [36, 17], [43, 57],
              [51, 30], [57, 76], [64, 13], [69, 47], [74, 68], [79, 27],
              [84, 56], [89, 18], [92, 78], [12, 86], [47, 91], [96, 42],
            ].map(([left, top], index) => (
              <span
                key={`${left}-${top}`}
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                  animationDelay: `${index * -0.31}s`,
                }}
              />
            ))}
          </div>
        </div>

        <div className="home-shell home-hero-content">
          <motion.div
            className="relative z-10 mx-auto max-w-[920px] text-center"
            initial={reduceMotion ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="home-kicker">
              <span className="home-kicker-dot" />
              JOYFlow · Interactive Visual Studio
            </div>
            <h1 className="home-hero-title mt-7 text-[clamp(48px,7.2vw,104px)] font-semibold leading-[1.08] tracking-[0.01em] text-white">
              互动视觉资产
              <span className="home-title-gradient block">工作台</span>
            </h1>
            <p className="mx-auto mt-8 max-w-[660px] text-[16px] leading-8 text-[#99a4b8] md:text-[18px]">
              从场景灵感、JOY 角色编排到静态与动态海报，
              在同一条创作流中把想法变成可复用的视觉资产。
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <button className="home-primary-button" onClick={onOpenAtlas}>
                <Sparkles size={17} />
                开始创作
                <ArrowRight size={16} />
              </button>
              <button className="home-secondary-button" onClick={scrollToCapabilities}>
                了解工作流
                <span className="home-scroll-mark">↓</span>
              </button>
            </div>
            <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs text-[#6f7b90]">
              <span className="flex items-center gap-2"><Layers3 size={14} className="text-[#6e8eff]" /> 场景与角色一体化</span>
              <span className="flex items-center gap-2"><WandSparkles size={14} className="text-[#9b7bff]" /> AI 辅助创作</span>
              <span className="flex items-center gap-2"><Film size={14} className="text-[#48d6d2]" /> 静态与动态输出</span>
            </div>
          </motion.div>
        </div>
        <div className="home-hero-footnote" aria-hidden="true">
          <span>MOVE TO EXPLORE</span>
          <i />
          <span>01 / 04</span>
        </div>
      </section>

      <section id="home-capabilities" className="home-section home-capabilities-section">
        <div className="home-shell">
          <div className="home-section-heading">
            <div>
              <span className="home-eyebrow">CORE WORKSPACES</span>
              <h2>
                <span>从一个入口，</span>
                <span>进入完整创作链路</span>
              </h2>
            </div>
            <p>核心功能按创作目标划分。无需先理解复杂工具，选择你想完成的结果即可。</p>
          </div>

          <div className="home-capability-grid">
            <motion.button
              className="home-capability-card home-capability-primary"
              whileHover={reduceMotion ? undefined : { y: -6 }}
              onClick={onOpenAtlas}
            >
              <div className="home-card-number">01</div>
              <div className="home-card-icon"><BookOpen size={22} /></div>
              <div className="relative z-10 mt-auto text-left">
                <span className="home-card-tag">主工作流 · 推荐从这里开始</span>
                <h3>角色海报</h3>
                <p>分析场景、生成画面、植入 JOY，并继续完成静态或动态海报。</p>
                <span className="home-card-link">进入角色海报 <ArrowRight size={15} /></span>
              </div>
              <div className="home-card-visual poster-mini-visual" aria-hidden="true">
                <span className="mini-visual-frame frame-one" />
                <span className="mini-visual-frame frame-two" />
                <span className="mini-visual-joy" />
              </div>
            </motion.button>

            <motion.button
              className="home-capability-card"
              whileHover={reduceMotion ? undefined : { y: -6 }}
              onClick={onOpenSpecialty}
            >
              <div className="home-card-number">02</div>
              <div className="home-card-icon is-purple"><Gift size={22} /></div>
              <div className="relative z-10 mt-auto text-left">
                <span className="home-card-tag">元素生产</span>
                <h3>道具元素</h3>
                <p>围绕地域与主题批量生成道具，再完成抠图与资产入库。</p>
                <span className="home-card-link">进入道具元素 <ArrowRight size={15} /></span>
              </div>
              <div className="home-card-visual props-mini-visual" aria-hidden="true">
                <span className="prop-cube cube-one" />
                <span className="prop-cube cube-two" />
                <span className="prop-cube cube-three" />
              </div>
            </motion.button>

            <motion.button
              className="home-capability-card"
              whileHover={reduceMotion ? undefined : { y: -6 }}
              onClick={onOpenJoy}
            >
              <div className="home-card-number">03</div>
              <div className="home-card-icon is-cyan"><Box size={22} /></div>
              <div className="relative z-10 mt-auto text-left">
                <span className="home-card-tag">角色编排</span>
                <h3>JOY 控制</h3>
                <p>通过预设动作、表情、变换和骨骼编辑，把角色放进你的画面。</p>
                <span className="home-card-link">打开 JOY 控制 <ArrowRight size={15} /></span>
              </div>
              <div className="home-card-visual joy-mini-visual" aria-hidden="true">
                <span className="joy-mini-head" />
                <span className="joy-mini-body" />
                <span className="joy-mini-axis axis-x" />
                <span className="joy-mini-axis axis-y" />
              </div>
            </motion.button>

            <motion.button
              className="home-capability-card"
              whileHover={reduceMotion ? undefined : { y: -6 }}
              onClick={onOpenPopup}
            >
              <div className="home-card-number">04</div>
              <div className="home-card-icon is-purple"><PanelsTopLeft size={22} /></div>
              <div className="relative z-10 mt-auto text-left">
                <span className="home-card-tag">营销弹窗 · 新工作流</span>
                <h3>动态弹窗</h3>
                <p>生成独立微缩场景，植入主体，编排标题与按钮，并按需制作动画。</p>
                <span className="home-card-link">进入动态弹窗 <ArrowRight size={15} /></span>
              </div>
              <div className="home-card-visual poster-mini-visual" aria-hidden="true">
                <span className="mini-visual-frame frame-one" />
                <span className="mini-visual-frame frame-two" />
                <span className="mini-visual-joy" />
              </div>
            </motion.button>
          </div>
        </div>
      </section>

      <section className="home-section home-workflow-section">
        <div className="home-shell">
          <div className="home-workflow-layout">
            <div className="home-workflow-copy">
              <span className="home-eyebrow">ONE CONTINUOUS FLOW</span>
              <h2>
                <span>让灵感贯穿</span>
                <span>完整创作流程</span>
              </h2>
              <p>
                每一步都会继承前一步的场景、尺寸与资产状态。
                你可以随时回看或调整，而不必从头开始。
              </p>
              <button className="home-secondary-button mt-8" onClick={onOpenAtlas}>
                体验完整工作流
                <ArrowRight size={15} />
              </button>
            </div>

            <div className="home-workflow-track">
              <div className="home-workflow-line">
                <motion.span
                  animate={{ height: `${((activeStep + 0.5) / workflowSteps.length) * 100}%` }}
                  transition={{ duration: reduceMotion ? 0 : 0.55, ease: 'easeOut' }}
                />
              </div>
              {workflowSteps.map((step, index) => {
                const isActive = activeStep === index;
                const isPast = activeStep > index;
                return (
                  <button
                    key={step.number}
                    className={`home-workflow-step ${isActive ? 'is-active' : ''} ${isPast ? 'is-past' : ''}`}
                    onMouseEnter={() => setActiveStep(index)}
                    onFocus={() => setActiveStep(index)}
                    onClick={onOpenAtlas}
                  >
                    <span className="home-workflow-node">{isPast ? '✓' : step.number}</span>
                    <span>
                      <strong>{step.title}</strong>
                      <small>{step.detail}</small>
                    </span>
                    <ArrowRight size={15} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="home-section home-tools-section">
        <div className="home-shell">
          <div className="home-section-heading">
            <div>
              <span className="home-eyebrow">YOUR WORKBENCH</span>
              <h2>
                <span>继续创作，</span>
                <span>或整理已有资产</span>
              </h2>
            </div>
            <p>任务、素材和辅助工具都在这里。首页只呈现下一步，不堆叠复杂参数。</p>
          </div>

          <div className="home-tool-grid">
            <button className="home-resume-card" onClick={onOpenAtlas}>
              <div className="home-resume-icon"><Play size={20} fill="currentColor" /></div>
              <div className="min-w-0 text-left">
                <span className="home-card-tag">{recentProject ? '继续上次任务' : '创建第一个任务'}</span>
                <h3>{recentProject?.name || '开始一张新的角色海报'}</h3>
                <p>
                  {recentProject
                    ? `${stageLabels[recentProject.currentStage]} · ${recentProject.outputRatio} · ${formatRelativeTime(recentProject.updatedAt)}`
                    : '从场景分析开始，建立一条完整的视觉生产流程。'}
                </p>
              </div>
              <ArrowRight className="ml-auto shrink-0 text-[#8192b4]" size={20} />
            </button>

            <button className="home-tool-card" onClick={onOpenLibrary}>
              <span className="home-tool-icon"><PackageOpen size={20} /></span>
              <span>
                <strong>素材仓库</strong>
                <small>管理场景、角色与输出资产</small>
              </span>
              <ArrowRight size={16} />
            </button>

            <button className="home-tool-card" onClick={onOpenFormats}>
              <span className="home-tool-icon is-purple"><ArrowLeftRight size={20} /></span>
              <span>
                <strong>转格式工具</strong>
                <small>视频、PNG 序列与 GIF 转换</small>
              </span>
              <ArrowRight size={16} />
            </button>
          </div>

          <div className="home-footer">
            <span className="flex items-center gap-2"><Sparkles size={14} /> JOYFlow</span>
            <span>互动视觉资产生产工作台</span>
            <div className="flex items-center gap-5">
              <span className="flex items-center gap-1.5"><Workflow size={13} /> 连续工作流</span>
              <span className="flex items-center gap-1.5"><Boxes size={13} /> 统一资产库</span>
              <span className="flex items-center gap-1.5"><Clock3 size={13} /> 自动保存</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
