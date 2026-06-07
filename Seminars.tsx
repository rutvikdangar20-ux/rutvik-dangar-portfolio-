import React, { useRef, useState } from "react";
import { Mic, TrendingUp, BarChart3, Film, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";

export default function Seminars() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const container = scrollRef.current;
    const itemWidth = container.scrollWidth / seminars.length;
    const newIndex = Math.round(container.scrollLeft / itemWidth);
    setActiveIndex(Math.min(newIndex, seminars.length - 1));
  };


  const seminars = [
    {
      title: "Podcasting Workshop",
      subtitle: "Art, Science & Commerce of Podcasting by AMA",
      icon: <Mic size={32} />,
      learnings:
        "Gained insights into content creation, audience engagement strategies, and the technical aspects of podcast production. Enhanced communication skills and learned monetization models in the audio industry.",
      color: "bg-blue-50 text-blue-900",
      accent: "bg-blue-100",
    },
    {
      title: "Creator Economy Seminar",
      subtitle: "Digital Marketing & Creator Economy",
      icon: <TrendingUp size={32} />,
      learnings:
        "Explored advanced digital marketing trends, personal branding, and the role of AI in modern content strategies. Deepened understanding of how creators monetize their online presence.",
      color: "bg-purple-50 text-purple-900",
      accent: "bg-purple-100",
    },
    {
      title: "Data Analysis Seminar",
      subtitle: "Insights from Industry Experts",
      icon: <BarChart3 size={32} />,
      learnings:
        "Learned professional data analysis workflows, data storytelling, and strategic decision-making based on metrics. Highlighted the importance of data-driven approaches in tech and business.",
      color: "bg-emerald-50 text-emerald-900",
      accent: "bg-emerald-100",
    },
    {
      title: "The Magic of 30 Seconds",
      subtitle: "Crafting Effective Ad Films by AMA",
      icon: <Film size={32} />,
      learnings:
        "Studied the nuances of brand storytelling, visual communication, and the psychology behind high-impact advertising. Improved creative thinking and understanding of consumer behavior.",
      color: "bg-rose-50 text-rose-900",
      accent: "bg-rose-100",
    },
  ];

  return (
    <section
      id="seminars"
      className="py-24 px-6 relative overflow-hidden bg-transparent"
    >
      <div className="max-w-7xl mx-auto relative z-10">
        <div className="mb-16 md:text-center text-left" >
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-navy/5 text-navy rounded-full text-xs font-bold tracking-wide border border-navy/10 uppercase mb-6">
            <Mic size={14} />
            <h2>Seminars & Workshops</h2>
          </div>
          <h3 className="text-4xl md:text-5xl font-sans font-bold text-navy tracking-tight mb-6">
            Continuous Learning
          </h3>
          <p className="text-charcoal/70 text-lg max-w-2xl mx-auto font-medium">
            Professional development through industry events focused on
            marketing, media, technology, and analytics.
          </p>
        </div>

        {/* Horizontal scroll always */}
        <div
          ref={scrollRef}
          onScroll={handleScroll} className="flex overflow-x-auto gap-6 pb-6 snap-x snap-mandatory hide-scrollbar pl-4 md:pl-0 pr-4"
        >
          {seminars.map((seminar, i) => (
            <motion.div 
              initial={{ opacity: 0, x: 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              key={i} className={`snap-center shrink-0 w-[85vw] md:w-[400px] p-8 rounded-3xl ${seminar.color} border border-white/50 shadow-xl shadow-black/5 flex flex-col h-full relative group transition-transform duration-300 hover:-translate-y-2`}
            >
              <div
                className={`w-16 h-16 rounded-2xl ${seminar.accent} flex items-center justify-center mb-8 transform -rotate-3 group-hover:rotate-0 transition-transform duration-300 shadow-sm`}>
                {seminar.icon}
              </div>

              <h4 className="text-2xl font-bold mb-2 pr-4">{seminar.title}</h4>

              <div className="flex flex-col gap-2 mb-6">
                <span className="text-sm font-semibold opacity-80 flex items-center gap-1.5 border-l-2 border-current pl-2">
                  {seminar.subtitle}
                </span>
              </div>

              <p className="text-sm leading-relaxed opacity-90 mt-auto">
                <span className="font-bold uppercase text-[10px] tracking-wider opacity-60 block mb-2">
                  Key Takeaways
                </span>
                {seminar.learnings}
              </p>

              <div className="absolute top-8 right-8 opacity-0 group-hover:opacity-100 transition-opacity duration-300 -translate-x-4 group-hover:translate-x-0">
                <ArrowRight size={24} className="text-current opacity-50" />
              </div>
            </motion.div>
          ))}
        </div>

        {/* Pagination Indicator */}
        <div className="flex flex-col items-center justify-center pt-2 pb-6 max-w-[85vw] mx-auto opacity-80">
          <div className="flex gap-1.5 mb-2.5">
            {seminars.map((_, i) => (
              <div
                key={i} className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === activeIndex ? "w-5 bg-navy" : "w-1.5 bg-navy/20"
                }`}
              />
            ))}
          </div>
          <div className="text-navy/70 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
            <span>Swipe</span>
            <span className="text-navy/40">&mdash;</span>
            <span className="text-navy">
              →
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
