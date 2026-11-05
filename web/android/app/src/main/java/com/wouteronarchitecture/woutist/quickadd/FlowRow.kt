package com.wouteronarchitecture.woutist.quickadd

import android.content.Context
import android.view.View
import android.view.ViewGroup

/** Lays children out left to right and wraps onto the next line when one doesn't fit (the reminder chips). */
class FlowRow(context: Context, private val hGap: Int, private val vGap: Int) : ViewGroup(context) {
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val maxWidth = MeasureSpec.getSize(widthMeasureSpec) - paddingLeft - paddingRight
        var x = 0
        var y = 0
        var lineHeight = 0
        for (child in children()) {
            child.measure(MeasureSpec.makeMeasureSpec(maxWidth, MeasureSpec.AT_MOST), MeasureSpec.UNSPECIFIED)
            if (x > 0 && x + child.measuredWidth > maxWidth) {
                x = 0
                y += lineHeight + vGap
                lineHeight = 0
            }
            x += child.measuredWidth + hGap
            lineHeight = maxOf(lineHeight, child.measuredHeight)
        }
        setMeasuredDimension(
            resolveSize(maxWidth + paddingLeft + paddingRight, widthMeasureSpec),
            resolveSize(y + lineHeight + paddingTop + paddingBottom, heightMeasureSpec),
        )
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val maxWidth = r - l - paddingLeft - paddingRight
        var x = 0
        var y = 0
        var lineHeight = 0
        val rtl = layoutDirection == View.LAYOUT_DIRECTION_RTL
        for (child in children()) {
            if (x > 0 && x + child.measuredWidth > maxWidth) {
                x = 0
                y += lineHeight + vGap
                lineHeight = 0
            }
            val left = if (rtl) r - l - paddingRight - x - child.measuredWidth else paddingLeft + x
            child.layout(left, paddingTop + y, left + child.measuredWidth, paddingTop + y + child.measuredHeight)
            x += child.measuredWidth + hGap
            lineHeight = maxOf(lineHeight, child.measuredHeight)
        }
    }

    private fun children() = (0 until childCount).map { getChildAt(it) }.filter { it.visibility != View.GONE }
}
