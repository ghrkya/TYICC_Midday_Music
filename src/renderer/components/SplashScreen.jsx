/**
 * TYICC午间悦听 - 启动加载屏幕
 * 
 * 类似Adobe家族的无边窗口加载页面风格
 * 显示当前加载组件信息和进度
 */

import React from 'react'

export default function SplashScreen({ progress, status, networkOk }) {
  return (
    <div className="splash-screen">
      <div className="splash-content">
        {/* Logo区域 */}
        <div className="splash-logo">
          <img
            src="../static/国际课程中心logo2.png"
            alt="TYICC Logo"
            onError={(e) => {
              // 如果相对路径加载失败，尝试绝对路径
              e.target.src = '/static/国际课程中心logo2.png'
            }}
          />
        </div>

        {/* 标题 */}
        <h1 className="splash-title">TYICC 午间悦听制作器</h1>
        <p className="splash-subtitle">M I D D A Y   M U S I C</p>

        {/* 加载进度条 */}
        <div className="splash-loader">
          <div className="splash-loader-bar">
            <div
              className="splash-loader-fill"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>

          <div className="splash-status">
            <span className="splash-status-icon" />
            <span>{status}</span>
          </div>

          {/* 网络错误提示 */}
          {!networkOk && progress > 50 && (
            <div className="splash-error">
              ⚠️ Bilibili 网络连接失败，下载功能将受限
            </div>
          )}
        </div>
      </div>
    </div>
  )
}