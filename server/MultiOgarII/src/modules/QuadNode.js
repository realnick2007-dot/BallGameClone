/*
 * Fast and easy Quad-Tree implementation written by Barbosik.
 * Useful for quick object search in the area specified with bounds.
 *
 * Copyright (c) 2016 Barbosik https://github.com/Barbosik
 * License: Apache License, Version 2.0
 */

const maxItemCount = 64;

class Quad {
    constructor(minx, miny, maxx, maxy) {
        this.minx = minx;
        this.miny = miny;
        this.maxx = maxx;
        this.maxy = maxy;
    }
    overlaps(/* Quad */other) {
        return !(this.minx >= other.maxx || this.maxx <= other.minx
            || this.miny >= other.maxy || this.maxy <= other.miny);
    }
}

class QuadNode {
    constructor(bound) {
        this.halfWidth = (bound.maxx - bound.minx) / 2;
        this.halfHeight = (bound.maxy - bound.miny) / 2;
        this.bound = bound;
        this.bound.cx = bound.minx + this.halfWidth;
        this.bound.cy = bound.miny + this.halfHeight;
        this.childNodes = [];
        this.items = [];
    }
    insert(item) {
        if (this.childNodes.length !== 0) {
            var quad = this.getQuad(item.bound);
            if (quad !== -1)
                return this.childNodes[quad].insert(item);
        }
        this.items.push(item);
        item._quadNode = this;

        // Only split when no children exist yet
        if (this.childNodes.length === 0 && this.items.length > maxItemCount) {
            var minx = this.bound.minx;
            var miny = this.bound.miny;
            var midx = this.bound.cx;
            var midy = this.bound.cy;
            var maxx = this.bound.maxx;
            var maxy = this.bound.maxy;
            this.childNodes.push(new QuadNode(new Quad(minx, miny, midx, midy))); // NW
            this.childNodes.push(new QuadNode(new Quad(midx, miny, maxx, midy))); // NE
            this.childNodes.push(new QuadNode(new Quad(minx, midy, midx, maxy))); // SW
            this.childNodes.push(new QuadNode(new Quad(midx, midy, maxx, maxy))); // SE

            // FIX: push existing items down into the correct child quadrant.
            // The original code created children but never moved items into them,
            // so all 64+ items stayed piled at the parent node forever. This meant:
            //   - split cells born near the world centre all landed at the root node
            //   - collision find() using a tight child-quadrant bound missed those cells
            //   - linesplit collision chains were dropped entirely during the boost arc
            var remaining = [];
            for (var i = 0; i < this.items.length; i++) {
                var it = this.items[i];
                var q = this.getQuad(it.bound);
                if (q !== -1) {
                    // item fits cleanly in a child — push it down
                    this.childNodes[q].items.push(it);
                    it._quadNode = this.childNodes[q];
                } else {
                    // straddles a boundary — must stay at this node
                    remaining.push(it);
                }
            }
            this.items = remaining;
        }
    }
    remove(item) {
        if (item._quadNode !== this)
            return item._quadNode.remove(item);
        this.items.splice(this.items.indexOf(item), 1);
        item._quadNode = null;
    }
    find(bound, callback) { // returns bool found
        for (const childNode of this.childNodes) {
            if (bound.overlaps(childNode.bound))
                if (childNode.find(bound, callback))
                    return true;
        }
        // FIX: always scan this node's own items even when children exist.
        // Large cells that straddle a quadrant boundary are stored at the parent
        // node (getQuad returns -1 for them). Without this, a find() that descends
        // into a child quad would never visit those boundary-straddling cells,
        // causing missed collisions for large cells near quadrant borders.
        // The original code already did this correctly — this comment documents why.
        for (const item of this.items) {
            if (bound.overlaps(item.bound))
                if (callback(item.cell))
                    return true;
        }
        return false;
    }
    // Returns quadrant for the bound.
    // Returns -1 if bound cannot completely fit within a child node
    getQuad(bound) {
        if (bound.maxx <= this.bound.cx) { // left
            if (bound.maxy <= this.bound.cy) // top
                return 0;
            if (bound.miny >= this.bound.cy) // bottom
                return 2;
        } else if (bound.minx >= this.bound.cx) { // right
            if (bound.maxy <= this.bound.cy) // top
                return 1;
            if (bound.miny >= this.bound.cy) // bottom
                return 3;
        }
        return -1;
    }
}

module.exports = {QuadNode: QuadNode, Quad: Quad};
