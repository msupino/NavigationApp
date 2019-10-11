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
public class SceneData
{
    
    public List<Position> waypoints;

    public SceneData(List<GameObject> waypoints)
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
    }
}


