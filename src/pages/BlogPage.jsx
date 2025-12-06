import React from 'react';
import { Calendar } from 'lucide-react';

const BlogPage = () => {
    const posts = [
        {
            title: "The Future of AI in Education",
            excerpt: "How artificial intelligence is reshaping the way we assess and learn.",
            date: "Nov 24, 2024",
            author: "Sarah Johnson",
            category: "Technology"
        },
        {
            title: "Best Practices for Remote Proctoring",
            excerpt: "Ensuring integrity while maintaining student privacy in online exams.",
            date: "Nov 20, 2024",
            author: "Mike Chen",
            category: "Guides"
        },
        {
            title: "EduHorizon 2.0 Release Notes",
            excerpt: "Introducing new analytics dashboards and coding environments.",
            date: "Nov 15, 2024",
            author: "Team EduHorizon",
            category: "Product"
        }
    ];

    return (
        <div className="min-h-screen bg-white pt-24 pb-12">
            <div className="container mx-auto px-6">
                <div className="text-center max-w-3xl mx-auto mb-16">
                    <h1 className="text-4xl font-bold text-slate-900 mb-6">Blog</h1>
                    <p className="text-xl text-slate-500">
                        Insights, updates, and guides from the EduHorizon team.
                    </p>
                </div>

                <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                    {posts.map((post, index) => (
                        <div key={index} className="bg-slate-50 rounded-2xl overflow-hidden border border-slate-100 hover:shadow-lg transition-shadow">
                            <div className="h-48 bg-slate-200 w-full animate-pulse" /> {/* Placeholder for image */}
                            <div className="p-6">
                                <div className="flex items-center gap-2 text-xs text-blue-600 font-medium mb-3">
                                    <span className="bg-blue-50 px-2 py-1 rounded-full">{post.category}</span>
                                    <span className="text-slate-400 flex items-center gap-1">
                                        <Calendar className="h-3 w-3" /> {post.date}
                                    </span>
                                </div>
                                <h3 className="text-xl font-bold text-slate-900 mb-3 hover:text-blue-600 cursor-pointer">
                                    {post.title}
                                </h3>
                                <p className="text-slate-500 text-sm mb-4">
                                    {post.excerpt}
                                </p>
                                <div className="text-sm font-medium text-slate-900">
                                    By {post.author}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default BlogPage;
