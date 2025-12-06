import React from 'react';
import { Users, Target, Globe } from 'lucide-react';

const AboutPage = () => {
    return (
        <div className="min-h-screen bg-white pt-24 pb-12">
            <div className="container mx-auto px-6">
                <div className="max-w-4xl mx-auto text-center mb-16">
                    <h1 className="text-4xl font-bold text-slate-900 mb-6">About EduHorizon</h1>
                    <p className="text-xl text-slate-500 leading-relaxed">
                        We are a team of educators, engineers, and designers passionate about transforming the way the world learns and assesses.
                    </p>
                </div>

                <div className="grid md:grid-cols-3 gap-12 mb-20">
                    {[
                        {
                            icon: <Target className="h-8 w-8 text-blue-600" />,
                            title: "Our Mission",
                            description: "To democratize access to high-quality education tools and provide actionable intelligence to institutions worldwide."
                        },
                        {
                            icon: <Globe className="h-8 w-8 text-blue-600" />,
                            title: "Global Reach",
                            description: "Serving institutions across 50+ countries, adapting to diverse educational standards and requirements."
                        },
                        {
                            icon: <Users className="h-8 w-8 text-blue-600" />,
                            title: "Student Centric",
                            description: "Every feature we build starts with the student experience, ensuring fair, engaging, and effective learning."
                        }
                    ].map((item, index) => (
                        <div key={index} className="text-center p-6 bg-slate-50 rounded-2xl">
                            <div className="inline-flex p-3 bg-white rounded-xl shadow-sm mb-4">
                                {item.icon}
                            </div>
                            <h3 className="text-xl font-bold text-slate-900 mb-3">{item.title}</h3>
                            <p className="text-slate-500">{item.description}</p>
                        </div>
                    ))}
                </div>

                <div className="bg-blue-600 rounded-3xl p-12 text-center text-white">
                    <h2 className="text-3xl font-bold mb-6">Join our journey</h2>
                    <p className="text-lg text-blue-100 mb-8 max-w-2xl mx-auto">
                        We're always looking for partners and talent to help us shape the future of education.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default AboutPage;
