using System.IO;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;
using SFB;

//TODO:
// It can be much nicer if the saved data will be saved as coordinates, and not in scene units.


[System.Serializable]
public class Position
{
    public float x;
    public float y;
    public float z;

    public Position(float[] vector)
    {
        this.x = vector[0];
        this.y = vector[1];
        this.z = vector[2];
    }
}

[System.Serializable]
public class LegData
{
    public int inboundAltitude;
    public int outboundAltitude;
    public double flightSpeed;
    public bool drawMidLegIndication;

    public LegData(int inboundAltitude, int outboundAltitude, double flightSpeed, bool drawMidLegIndication)
    {
        this.inboundAltitude = inboundAltitude;
        this.outboundAltitude = outboundAltitude;
        this.flightSpeed = flightSpeed;
        this.drawMidLegIndication = drawMidLegIndication;
    }
}

[System.Serializable]
public class SceneData
{

    public List<Position> waypoints;
    public List<LegData> legs;

    public SceneData(List<GameObject> waypoints, List<Leg> legs)
    {

        this.waypoints = new List<Position>();

        foreach (GameObject wp in waypoints)
        {
            float[] vector = new float[3];
            vector[0] = wp.transform.position.x;
            vector[1] = wp.transform.position.y;
            vector[2] = wp.transform.position.z;
            this.waypoints.Add(new Position(vector));
        }

        this.legs = new List<LegData>();

        foreach (Leg leg in legs)
        {
            this.legs.Add(new LegData(leg.inboundAltitude, leg.outboundAltitude, leg.flightSpeed, leg.drawMidLegIndication));
        }
    }
}


